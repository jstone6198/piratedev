import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

const router = Router();

const DOMAIN_SUFFIX = 'callcommand.ai';
const DEPLOY_BASE_PORT = 4000;
const STATIC_ROOT_BASE = '/var/www/projects';
const NGINX_SITES_ENABLED = '/etc/nginx/sites-enabled';
const IGNORED_SCAN_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__']);

function validProjectName(name) {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function ensureProjectDir(workspaceDir, project) {
  if (!validProjectName(project)) {
    throw Object.assign(new Error('Invalid project name'), { statusCode: 400 });
  }

  const projectDir = path.resolve(workspaceDir, project);
  if (path.dirname(projectDir) !== workspaceDir) {
    throw Object.assign(new Error('Invalid project path'), { statusCode: 400 });
  }
  if (!fs.existsSync(projectDir)) {
    throw Object.assign(new Error('Project not found'), { statusCode: 404 });
  }

  return projectDir;
}

function findFirstPythonFile(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const name of ['app.py', 'main.py']) {
    const fullPath = path.join(dir, name);
    if (fs.existsSync(fullPath)) {
      return path.relative(dir, fullPath);
    }
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.py')) {
      return entry.name;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_SCAN_DIRS.has(entry.name) || entry.name.startsWith('.')) {
      continue;
    }
    const found = findFirstPythonFile(path.join(dir, entry.name));
    if (found) {
      return path.join(entry.name, found);
    }
  }

  return null;
}

function detectProjectType(projectDir) {
  if (fs.existsSync(path.join(projectDir, 'package.json'))) {
    return { type: 'node' };
  }

  if (fs.existsSync(path.join(projectDir, 'index.html'))) {
    return { type: 'static' };
  }

  const pythonEntry = findFirstPythonFile(projectDir);
  if (fs.existsSync(path.join(projectDir, 'requirements.txt')) || pythonEntry) {
    return { type: 'python', entry: pythonEntry || 'app.py' };
  }

  throw Object.assign(new Error('Unable to detect deployable project type'), { statusCode: 400 });
}

function getDeploymentsFile(workspaceDir) {
  const metaDir = path.resolve(workspaceDir, '..', '.josh-ide');
  fs.mkdirSync(metaDir, { recursive: true });
  return path.join(metaDir, 'deployments.json');
}

function readDeployments(workspaceDir) {
  const deploymentsFile = getDeploymentsFile(workspaceDir);
  if (!fs.existsSync(deploymentsFile)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(deploymentsFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeDeployments(workspaceDir, deployments) {
  fs.writeFileSync(getDeploymentsFile(workspaceDir), JSON.stringify(deployments, null, 2));
}

function getDomain(project) {
  return `${project}.${DOMAIN_SUFFIX}`;
}

function getPublicUrl(project) {
  return `https://${getDomain(project)}`;
}

function getNginxConfigPath(project) {
  return path.join(NGINX_SITES_ENABLED, getDomain(project));
}

function allocatePort(deployments, project) {
  if (deployments[project]?.port) {
    return deployments[project].port;
  }

  const usedPorts = new Set(
    Object.values(deployments)
      .map((deployment) => deployment?.port)
      .filter(Boolean)
  );

  let port = DEPLOY_BASE_PORT;
  while (usedPorts.has(port)) {
    port += 1;
  }
  return port;
}

function writeNginxConfig(project, config) {
  const tempPath = path.join('/tmp', `${getDomain(project)}.nginx.conf`);
  fs.writeFileSync(tempPath, config);
  try {
    execSync(`sudo cp ${shellEscape(tempPath)} ${shellEscape(getNginxConfigPath(project))}`);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function reloadNginx() {
  execSync('sudo nginx -t', { stdio: 'pipe' });
  execSync('sudo systemctl reload nginx', { stdio: 'pipe' });
}

function stopPm2Process(processName) {
  execSync(`pm2 delete ${shellEscape(processName)}`, { stdio: 'pipe' });
}

function isPm2ProcessOnline(processName) {
  try {
    const raw = execSync('pm2 jlist', { stdio: 'pipe' }).toString();
    const processes = JSON.parse(raw);
    return processes.some((entry) => (
      entry?.name === processName &&
      entry?.pm2_env?.status === 'online'
    ));
  } catch {
    return false;
  }
}

function isDeploymentActive(project, deployment) {
  if (!deployment) {
    return false;
  }

  if (!fs.existsSync(getNginxConfigPath(project))) {
    return false;
  }

  if (deployment.type === 'static') {
    return fs.existsSync(path.join(STATIC_ROOT_BASE, project));
  }

  return Boolean(deployment.processName) && isPm2ProcessOnline(deployment.processName);
}

function cleanupDeploymentArtifacts(project, deployment) {
  if (deployment?.processName) {
    try {
      stopPm2Process(deployment.processName);
    } catch {}
  }

  try {
    execSync(`sudo rm -f ${shellEscape(getNginxConfigPath(project))}`, { stdio: 'pipe' });
  } catch {}

  try {
    execSync(`sudo rm -rf ${shellEscape(path.join(STATIC_ROOT_BASE, project))}`, { stdio: 'pipe' });
  } catch {}
}

function createStaticNginxConfig(project) {
  const domain = getDomain(project);
  const rootDir = path.join(STATIC_ROOT_BASE, project);

  return `server {
    listen 80;
    server_name ${domain};

    root ${rootDir};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;
}

function createProxyNginxConfig(project, port) {
  const domain = getDomain(project);

  return `server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`;
}

function deployStaticProject(project, projectDir) {
  const targetDir = path.join(STATIC_ROOT_BASE, project);

  execSync(`sudo rm -rf ${shellEscape(targetDir)}`);
  execSync(`sudo mkdir -p ${shellEscape(targetDir)}`);
  execSync(`sudo cp -R ${shellEscape(path.join(projectDir, '.'))} ${shellEscape(targetDir)}`);
  writeNginxConfig(project, createStaticNginxConfig(project));
  reloadNginx();

  return { type: 'static', url: getPublicUrl(project) };
}

function deployNodeProject(project, projectDir, deployments) {
  const processName = `deploy-${project}`;
  const port = allocatePort(deployments, project);
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  const preferredEntries = ['server.js', 'index.js', 'app.js', 'main.js'];
  const entry = preferredEntries.find((file) => fs.existsSync(path.join(projectDir, file)));

  try {
    stopPm2Process(processName);
  } catch {}

  if (packageJson.scripts?.start) {
    execSync(`pm2 start npm --name ${shellEscape(processName)} -- start`, {
      cwd: projectDir,
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });
  } else if (entry) {
    execSync(`pm2 start ${shellEscape(entry)} --name ${shellEscape(processName)}`, {
      cwd: projectDir,
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });
  } else {
    throw Object.assign(new Error('Node project needs a start script or server entry file'), { statusCode: 400 });
  }

  writeNginxConfig(project, createProxyNginxConfig(project, port));
  reloadNginx();

  return { type: 'node', port, processName, url: getPublicUrl(project) };
}

function deployPythonProject(project, projectDir, deployments, entry) {
  const processName = `deploy-${project}`;
  const port = allocatePort(deployments, project);
  const pythonEntry = entry || findFirstPythonFile(projectDir);

  if (!pythonEntry) {
    throw Object.assign(new Error('Python project needs a .py entry file'), { statusCode: 400 });
  }

  try {
    stopPm2Process(processName);
  } catch {}

  execSync(`pm2 start python3 --name ${shellEscape(processName)} -- ${shellEscape(pythonEntry)}`, {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: 'pipe',
  });

  writeNginxConfig(project, createProxyNginxConfig(project, port));
  reloadNginx();

  return { type: 'python', port, processName, entry: pythonEntry, url: getPublicUrl(project) };
}

function buildStatusResponse(project, detected, deployment) {
  const active = isDeploymentActive(project, deployment);
  const status = !deployment ? 'not_deployed' : active ? 'deployed' : 'stopped';

  return {
    project,
    type: deployment?.type || detected.type,
    status,
    deployed: active,
    url: active ? deployment?.url || null : null,
    estimatedUrl: getPublicUrl(project),
    port: active ? deployment?.port || null : null,
    deployedAt: deployment?.deployedAt || null,
  };
}

function getLoggableDeployment(workspaceDir, project) {
  if (!validProjectName(project)) {
    throw Object.assign(new Error('Invalid project name'), { statusCode: 400 });
  }

  const deployments = readDeployments(workspaceDir);
  const deployment = deployments[project];
  if (!deployment) {
    throw Object.assign(new Error('Deployment not found'), { statusCode: 404 });
  }

  if (!deployment.processName) {
    throw Object.assign(new Error('Logs are only available for PM2-backed deployments'), { statusCode: 400 });
  }

  return deployment;
}

function detectLogStream(line, fallback = 'stdout') {
  const normalized = String(line || '');

  if (/\b(?:stderr|err)\b/i.test(normalized)) {
    return 'stderr';
  }

  if (/\b(?:stdout|out)\b/i.test(normalized)) {
    return 'stdout';
  }

  return fallback;
}

function mapLogLine(line, fallback) {
  return {
    stream: detectLogStream(line, fallback),
    text: line,
  };
}

function createSseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function writeSseEvent(res, payload) {
  res.write(createSseEvent(payload));
}

function streamProcessOutput(stream, fallback, onLine) {
  let buffer = '';

  const flush = () => {
    const segments = buffer.split(/\r?\n/);
    buffer = segments.pop() || '';

    for (const segment of segments) {
      if (!segment.trim()) continue;
      onLine(mapLogLine(segment, fallback));
    }
  };

  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    flush();
  });

  stream.on('end', () => {
    if (buffer.trim()) {
      onLine(mapLogLine(buffer, fallback));
      buffer = '';
    }
  });
}

router.post('/:project', (req, res) => {
  const { project } = req.params;
  const workspaceDir = req.app.locals.workspaceDir;

  try {
    const projectDir = ensureProjectDir(workspaceDir, project);
    const detected = detectProjectType(projectDir);
    const deployments = readDeployments(workspaceDir);
    const existingDeployment = deployments[project];

    cleanupDeploymentArtifacts(project, existingDeployment);

    let deployment;
    if (detected.type === 'static') {
      deployment = deployStaticProject(project, projectDir);
    } else if (detected.type === 'node') {
      deployment = deployNodeProject(project, projectDir, deployments);
    } else {
      deployment = deployPythonProject(project, projectDir, deployments, detected.entry);
    }

    deployments[project] = {
      ...deployment,
      project,
      nginxConfigPath: getNginxConfigPath(project),
      deployedAt: new Date().toISOString(),
    };
    writeDeployments(workspaceDir, deployments);

    res.json({
      url: deployment.url,
      status: 'deployed',
      type: deployment.type,
    });
  } catch (error) {
    console.error('[deploy] deploy failed:', error);
    res.status(error.statusCode || 500).json({
      error: 'Deployment failed',
      message: error.message,
    });
  }
});

router.get('/:project/status', (req, res) => {
  const { project } = req.params;
  const workspaceDir = req.app.locals.workspaceDir;

  try {
    const projectDir = ensureProjectDir(workspaceDir, project);
    const detected = detectProjectType(projectDir);
    const deployments = readDeployments(workspaceDir);
    const deployment = deployments[project] || null;

    if (deployment && !isDeploymentActive(project, deployment)) {
      delete deployments[project];
      writeDeployments(workspaceDir, deployments);
    }

    res.json(buildStatusResponse(project, detected, deployments[project] || null));
  } catch (error) {
    console.error('[deploy] status failed:', error);
    res.status(error.statusCode || 500).json({
      error: 'Failed to load deployment status',
      message: error.message,
    });
  }
});

router.get('/:project/logs', (req, res) => {
  const { project } = req.params;
  const workspaceDir = req.app.locals.workspaceDir;

  try {
    const deployment = getLoggableDeployment(workspaceDir, project);
    const output = execSync(`pm2 logs ${shellEscape(deployment.processName)} --lines 200 --nostream`, {
      stdio: 'pipe',
      encoding: 'utf8',
    });

    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => mapLogLine(line, 'stdout'));

    res.json({
      project,
      lines,
    });
  } catch (error) {
    console.error('[deploy] logs failed:', error);
    res.status(error.statusCode || 500).json({
      error: 'Failed to load deployment logs',
      message: error.message,
    });
  }
});

router.get('/:project/logs/stream', (req, res) => {
  const { project } = req.params;
  const workspaceDir = req.app.locals.workspaceDir;

  try {
    const deployment = getLoggableDeployment(workspaceDir, project);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const pm2 = spawn('pm2', ['logs', deployment.processName, '--lines', '0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    streamProcessOutput(pm2.stdout, 'stdout', (entry) => writeSseEvent(res, entry));
    streamProcessOutput(pm2.stderr, 'stderr', (entry) => writeSseEvent(res, entry));

    pm2.on('error', (error) => {
      writeSseEvent(res, {
        stream: 'stderr',
        text: error.message || 'Failed to stream PM2 logs',
      });
    });

    pm2.on('close', (code) => {
      clearInterval(heartbeat);
      writeSseEvent(res, {
        stream: code === 0 ? 'stdout' : 'stderr',
        text: code === 0 ? '[pm2 logs stream closed]' : `[pm2 logs exited with code ${code}]`,
      });
      res.end();
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      if (!pm2.killed) {
        pm2.kill('SIGTERM');
      }
    });
  } catch (error) {
    console.error('[deploy] log stream failed:', error);
    res.status(error.statusCode || 500).json({
      error: 'Failed to stream deployment logs',
      message: error.message,
    });
  }
});

router.delete('/:project', (req, res) => {
  const { project } = req.params;
  const workspaceDir = req.app.locals.workspaceDir;

  try {
    if (!validProjectName(project)) {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    const deployments = readDeployments(workspaceDir);
    const deployment = deployments[project];

    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    cleanupDeploymentArtifacts(project, deployment);
    reloadNginx();

    delete deployments[project];
    writeDeployments(workspaceDir, deployments);

    res.json({ project, status: 'removed' });
  } catch (error) {
    console.error('[deploy] teardown failed:', error);
    res.status(error.statusCode || 500).json({
      error: 'Failed to tear down deployment',
      message: error.message,
    });
  }
});

export default router;
