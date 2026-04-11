import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

const router = Router();

const DOMAIN_SUFFIX = 'piratedev.ai';
const DEPLOY_BASE_PORT = 4000;
const STATIC_ROOT_BASE = '/var/www/projects';
const NGINX_SITES_ENABLED = '/etc/nginx/sites-enabled';
const IGNORED_SCAN_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__']);
const DEPLOY_TYPES = new Set(['always-on', 'static', 'auto-restart', 'cluster']);
const HEALTH_INJECTION_MARKER = 'PirateDev injected health check';

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
  const metaDir = path.resolve(workspaceDir, '..', '.piratedev');
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

function normalizeDeployType(requestedType, detected) {
  if (!requestedType) {
    return detected.type === 'static' ? 'static' : 'always-on';
  }

  if (!DEPLOY_TYPES.has(requestedType)) {
    throw Object.assign(new Error('Invalid deploy type'), { statusCode: 400 });
  }

  return requestedType;
}

function normalizeInstances(value, fallback = 2) {
  const parsed = Number.parseInt(value ?? fallback, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
    throw Object.assign(new Error('Instances must be an integer between 1 and 4'), { statusCode: 400 });
  }

  return parsed;
}

function getDeploymentType(deployment, detectedType = null) {
  if (!deployment) {
    return detectedType;
  }

  if (deployment.deployType) {
    return deployment.deployType;
  }

  if (DEPLOY_TYPES.has(deployment.type)) {
    return deployment.type;
  }

  if (deployment.type === 'static') {
    return 'static';
  }

  return 'always-on';
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

  if (getDeploymentType(deployment) === 'static') {
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

function getPm2ProcessEntries(processName) {
  const raw = execSync('pm2 jlist', { stdio: 'pipe' }).toString();
  const processes = JSON.parse(raw);
  return processes.filter((entry) => entry?.name === processName);
}

function getPm2ProcessSummary(processName) {
  const entries = getPm2ProcessEntries(processName);
  if (!entries.length) {
    throw Object.assign(new Error('PM2 process not found'), { statusCode: 404 });
  }

  const statuses = entries.map((entry) => entry?.pm2_env?.status || 'unknown');
  const onlineCount = statuses.filter((status) => status === 'online').length;
  const startedAtValues = entries
    .map((entry) => entry?.pm2_env?.pm_uptime)
    .filter((value) => Number.isFinite(value));
  const startedAt = startedAtValues.length ? Math.min(...startedAtValues) : null;
  const uptime = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null;
  const pids = entries.map((entry) => entry?.pid).filter(Boolean);

  return {
    status: onlineCount === entries.length ? 'online' : onlineCount > 0 ? 'partial' : statuses[0],
    uptime,
    memory: entries.reduce((total, entry) => total + (entry?.monit?.memory || 0), 0),
    cpu: entries.reduce((total, entry) => total + (entry?.monit?.cpu || 0), 0),
    restarts: entries.reduce((total, entry) => total + (entry?.pm2_env?.restart_time || 0), 0),
    pid: pids.length === 1 ? pids[0] : pids,
    instances: entries.length,
  };
}

function listSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_SCAN_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.(?:js|mjs|cjs|ts|py)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function projectHasHealthEndpoint(projectDir) {
  return listSourceFiles(projectDir).some((file) => {
    const content = fs.readFileSync(file, 'utf8');
    return /['"`]\/health['"`]/.test(content) || /@[\w.]+\.route\(\s*['"]\/health['"]/.test(content);
  });
}

function resolveNodeEntry(projectDir, packageJson) {
  const startScript = packageJson.scripts?.start || '';
  const scriptMatch = startScript.match(/\bnode\s+([^\s]+)/);
  if (scriptMatch && fs.existsSync(path.join(projectDir, scriptMatch[1]))) {
    return scriptMatch[1];
  }

  const preferredEntries = ['server.js', 'index.js', 'app.js', 'main.js'];
  const preferredEntry = preferredEntries.find((file) => fs.existsSync(path.join(projectDir, file)));
  if (preferredEntry) {
    return preferredEntry;
  }

  const packageEntry = packageJson.main;
  if (packageEntry && fs.existsSync(path.join(projectDir, packageEntry))) {
    return packageEntry;
  }

  return null;
}

function injectNodeHealthRoute(entryPath) {
  const content = fs.readFileSync(entryPath, 'utf8');
  if (/['"`]\/health['"`]/.test(content) || content.includes(HEALTH_INJECTION_MARKER)) {
    return false;
  }

  const route = `\n// ${HEALTH_INJECTION_MARKER}\napp.get('/health', (req, res) => res.json({ status: 'ok' }));\n`;
  const appDeclaration = /(?:const|let|var)\s+app\s*=\s*express\s*\([^)]*\)\s*;?/;
  const declarationMatch = content.match(appDeclaration);

  if (declarationMatch?.index !== undefined) {
    const insertAt = declarationMatch.index + declarationMatch[0].length;
    fs.writeFileSync(entryPath, `${content.slice(0, insertAt)}${route}${content.slice(insertAt)}`);
    return true;
  }

  const guardedRoute = `\n// ${HEALTH_INJECTION_MARKER}\nif (typeof app !== 'undefined' && app?.get) {\n  app.get('/health', (req, res) => res.json({ status: 'ok' }));\n}\n`;
  fs.writeFileSync(entryPath, `${content.trimEnd()}${guardedRoute}`);
  return true;
}

function injectPythonHealthRoute(entryPath) {
  const content = fs.readFileSync(entryPath, 'utf8');
  if (/['"]\/health['"]/.test(content) || content.includes(HEALTH_INJECTION_MARKER)) {
    return false;
  }

  let route;
  if (/\bapp\s*=\s*FastAPI\s*\(/.test(content)) {
    route = `\n# ${HEALTH_INJECTION_MARKER}\n@app.get('/health')\nasync def _josh_health():\n    return {'status': 'ok'}\n\n`;
  } else if (/\bapp\s*=\s*Flask\s*\(/.test(content)) {
    route = `\n# ${HEALTH_INJECTION_MARKER}\n@app.route('/health')\ndef _josh_health():\n    return {'status': 'ok'}\n\n`;
  } else {
    return false;
  }

  const mainMatch = content.match(/\nif\s+__name__\s*==\s*['"]__main__['"]\s*:/);
  if (mainMatch?.index !== undefined) {
    fs.writeFileSync(entryPath, `${content.slice(0, mainMatch.index)}${route}${content.slice(mainMatch.index)}`);
  } else {
    fs.writeFileSync(entryPath, `${content.trimEnd()}${route}`);
  }

  return true;
}

function ensureHealthRoute(projectDir, detected, entry = null) {
  if (detected.type === 'static' || projectHasHealthEndpoint(projectDir)) {
    return { injected: false };
  }

  if (detected.type === 'node' && entry) {
    return {
      injected: injectNodeHealthRoute(path.join(projectDir, entry)),
      entry,
    };
  }

  if (detected.type === 'python') {
    const pythonEntry = entry || detected.entry || findFirstPythonFile(projectDir);
    if (pythonEntry) {
      return {
        injected: injectPythonHealthRoute(path.join(projectDir, pythonEntry)),
        entry: pythonEntry,
      };
    }
  }

  return { injected: false };
}

function buildPm2Options(deployType, instances = 2) {
  if (deployType === 'auto-restart') {
    return '--watch --max-restarts 10 --restart-delay 5000';
  }

  if (deployType === 'cluster') {
    return `--exec-mode cluster -i ${instances}`;
  }

  return '';
}

function deployStaticProject(project, projectDir, runtimeType = 'static') {
  const targetDir = path.join(STATIC_ROOT_BASE, project);

  execSync(`sudo rm -rf ${shellEscape(targetDir)}`);
  execSync(`sudo mkdir -p ${shellEscape(targetDir)}`);
  execSync([
    'sudo rsync -a --delete --prune-empty-dirs',
    "--include '*/'",
    "--include '*.html'",
    "--include '*.css'",
    "--include '*.js'",
    "--exclude '*'",
    `${shellEscape(path.join(projectDir, '/'))} ${shellEscape(`${targetDir}/`)}`,
  ].join(' '));
  writeNginxConfig(project, createStaticNginxConfig(project));
  reloadNginx();

  return { type: 'static', deployType: 'static', runtimeType, url: getPublicUrl(project), instances: 0 };
}

function deployNodeProject(project, projectDir, deployments, deployType = 'always-on', instances = 2) {
  const processName = `deploy-${project}`;
  const port = allocatePort(deployments, project);
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  const entry = resolveNodeEntry(projectDir, packageJson);
  const pm2Options = buildPm2Options(deployType, instances);

  try {
    stopPm2Process(processName);
  } catch {}

  ensureHealthRoute(projectDir, { type: 'node' }, entry);

  if (deployType === 'cluster') {
    if (!entry) {
      throw Object.assign(new Error('Cluster deploy requires a Node server entry file'), { statusCode: 400 });
    }

    execSync(`pm2 start ${shellEscape(entry)} --name ${shellEscape(processName)} ${pm2Options}`, {
      cwd: projectDir,
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });
  } else if (packageJson.scripts?.start) {
    execSync(`pm2 start npm --name ${shellEscape(processName)} ${pm2Options} -- start`, {
      cwd: projectDir,
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });
  } else if (entry) {
    execSync(`pm2 start ${shellEscape(entry)} --name ${shellEscape(processName)} ${pm2Options}`, {
      cwd: projectDir,
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });
  } else {
    throw Object.assign(new Error('Node project needs a start script or server entry file'), { statusCode: 400 });
  }

  writeNginxConfig(project, createProxyNginxConfig(project, port));
  reloadNginx();

  return {
    type: deployType,
    deployType,
    runtimeType: 'node',
    port,
    processName,
    entry,
    url: getPublicUrl(project),
    instances: deployType === 'cluster' ? instances : 1,
  };
}

function deployPythonProject(project, projectDir, deployments, entry, deployType = 'always-on') {
  const processName = `deploy-${project}`;
  const port = allocatePort(deployments, project);
  const pythonEntry = entry || findFirstPythonFile(projectDir);

  if (!pythonEntry) {
    throw Object.assign(new Error('Python project needs a .py entry file'), { statusCode: 400 });
  }

  try {
    stopPm2Process(processName);
  } catch {}

  if (deployType === 'cluster') {
    throw Object.assign(new Error('Cluster deploy is only supported for Node projects'), { statusCode: 400 });
  }

  ensureHealthRoute(projectDir, { type: 'python', entry: pythonEntry }, pythonEntry);

  const pm2Options = buildPm2Options(deployType);
  execSync(`pm2 start python3 --name ${shellEscape(processName)} ${pm2Options} -- ${shellEscape(pythonEntry)}`, {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: 'pipe',
  });

  writeNginxConfig(project, createProxyNginxConfig(project, port));
  reloadNginx();

  return {
    type: deployType,
    deployType,
    runtimeType: 'python',
    port,
    processName,
    entry: pythonEntry,
    url: getPublicUrl(project),
    instances: 1,
  };
}

function buildStatusResponse(project, detected, deployment) {
  const active = isDeploymentActive(project, deployment);
  const status = !deployment ? 'not_deployed' : active ? 'deployed' : 'stopped';
  let processSummary = null;

  if (active && deployment?.processName) {
    try {
      processSummary = getPm2ProcessSummary(deployment.processName);
    } catch {}
  }

  return {
    project,
    type: getDeploymentType(deployment, detected.type),
    runtimeType: deployment?.runtimeType || (DEPLOY_TYPES.has(deployment?.type) ? detected.type : deployment?.type) || detected.type,
    status,
    deployed: active,
    url: active ? deployment?.url || null : null,
    uptime: active ? processSummary?.uptime ?? null : null,
    instances: active ? processSummary?.instances || deployment?.instances || null : deployment?.instances || null,
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
    const deployType = normalizeDeployType(req.body?.type, detected);
    const instances = deployType === 'cluster' ? normalizeInstances(req.body?.instances, 2) : 1;
    const deployments = readDeployments(workspaceDir);
    const existingDeployment = deployments[project];

    cleanupDeploymentArtifacts(project, existingDeployment);

    let deployment;
    if (deployType === 'static') {
      deployment = deployStaticProject(project, projectDir, detected.type);
    } else if (detected.type === 'node') {
      deployment = deployNodeProject(project, projectDir, deployments, deployType, instances);
    } else if (detected.type === 'python') {
      deployment = deployPythonProject(project, projectDir, deployments, detected.entry, deployType);
    } else {
      throw Object.assign(new Error('Static projects must use static deploy type'), { statusCode: 400 });
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
      type: deployment.deployType,
      runtimeType: deployment.runtimeType,
      instances: deployment.instances,
    });
  } catch (error) {
    console.error('[deploy] deploy failed:', error);
    res.status(error.statusCode || 500).json({
      error: 'Deployment failed',
      message: error.message,
    });
  }
});

router.post('/:project/health', (req, res) => {
  const { project } = req.params;
  const workspaceDir = req.app.locals.workspaceDir;

  try {
    ensureProjectDir(workspaceDir, project);
    const deployments = readDeployments(workspaceDir);
    const deployment = deployments[project];

    if (!deployment) {
      throw Object.assign(new Error('Deployment not found'), { statusCode: 404 });
    }

    if (!deployment.processName) {
      throw Object.assign(new Error('Health metrics are only available for PM2-backed deployments'), { statusCode: 400 });
    }

    const { status, uptime, memory, cpu, restarts, pid } = getPm2ProcessSummary(deployment.processName);
    res.json({ status, uptime, memory, cpu, restarts, pid });
  } catch (error) {
    console.error('[deploy] health failed:', error);
    res.status(error.statusCode || 500).json({
      error: 'Failed to load deployment health',
      message: error.message,
    });
  }
});

router.post('/:project/scale', (req, res) => {
  const { project } = req.params;
  const workspaceDir = req.app.locals.workspaceDir;

  try {
    ensureProjectDir(workspaceDir, project);
    const instances = normalizeInstances(req.body?.instances, 2);
    const deployments = readDeployments(workspaceDir);
    const deployment = deployments[project];

    if (!deployment) {
      throw Object.assign(new Error('Deployment not found'), { statusCode: 404 });
    }

    if (getDeploymentType(deployment) !== 'cluster') {
      throw Object.assign(new Error('Only cluster deployments can be scaled'), { statusCode: 400 });
    }

    if (!deployment.processName) {
      throw Object.assign(new Error('Deployment is not PM2-backed'), { statusCode: 400 });
    }

    execSync(`pm2 scale ${shellEscape(deployment.processName)} ${instances}`, { stdio: 'pipe' });

    deployments[project] = {
      ...deployment,
      instances,
      scaledAt: new Date().toISOString(),
    };
    writeDeployments(workspaceDir, deployments);

    res.json({
      project,
      status: 'scaled',
      type: 'cluster',
      instances,
      url: deployment.url,
    });
  } catch (error) {
    console.error('[deploy] scale failed:', error);
    res.status(error.statusCode || 500).json({
      error: 'Failed to scale deployment',
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
