import { promises as fs } from "fs";
import path from "path";
import { spawn, exec as execCb } from "child_process";
import { promisify } from "util";

const execAsync = promisify(execCb);

const DEPLOY_ROOT = "/var/www/ide-projects";
const NGINX_SITES = "/etc/nginx/sites-enabled";
const DOMAIN_SUFFIX = "ide.callcommand.ai";
const PM2 = "/home/claude-runner/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2";

function sanitize(name) {
  return name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 40);
}

async function detectProjectType(projectDir) {
  const files = await fs.readdir(projectDir).catch(() => []);
  if (files.includes("package.json")) {
    const pkg = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8").catch(() => "{}"));
    if (pkg.scripts?.start) return { type: "node", command: "npm start" };
    if (pkg.main) return { type: "node", command: `node ${pkg.main}` };
    if (files.includes("index.js")) return { type: "node", command: "node index.js" };
    if (files.includes("server.js")) return { type: "node", command: "node server.js" };
  }
  if (files.includes("requirements.txt") || files.includes("main.py")) return { type: "python", command: "python3 main.py" };
  if (files.includes("index.html")) return { type: "static", command: null };
  return { type: "unknown", command: null };
}

function generateNginxConfig(subdomain, projectType, port) {
  const serverName = `${subdomain}.${DOMAIN_SUFFIX}`;
  if (projectType === "static") {
    return `server {
    listen 80;
    server_name ${serverName};
    root ${DEPLOY_ROOT}/${subdomain};
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
`;
  }
  return `server {
    listen 80;
    server_name ${serverName};
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`;
}

async function findFreePort(start = 4000) {
  for (let p = start; p < 5000; p++) {
    try {
      const { stdout } = await execAsync(`ss -tlnp | grep :${p}`);
      if (!stdout.trim()) return p;
    } catch { return p; }
  }
  return start;
}

export default function setupSubdomainDeploy(app, context) {
  const { workspace } = context;

  // List deployed projects
  app.get("/api/subdomain-deploy/list", async (req, res) => {
    try {
      const deployments = [];
      const configFiles = await fs.readdir(NGINX_SITES).catch(() => []);
      for (const f of configFiles) {
        if (f.startsWith("ide-project-")) {
          const subdomain = f.replace("ide-project-", "");
          const content = await fs.readFile(path.join(NGINX_SITES, f), "utf8");
          const isStatic = content.includes("try_files");
          const portMatch = content.match(/proxy_pass http:\/\/127\.0\.0\.1:(\d+)/);
          deployments.push({
            subdomain,
            url: `http://${subdomain}.${DOMAIN_SUFFIX}`,
            type: isStatic ? "static" : "app",
            port: portMatch ? parseInt(portMatch[1]) : null,
          });
        }
      }
      res.json({ deployments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Deploy a project
  app.post("/api/subdomain-deploy/:project", async (req, res) => {
    try {
      const project = req.params.project;
      const subdomain = sanitize(project);
      const projectDir = path.join(workspace, project);
      const stat = await fs.stat(projectDir).catch(() => null);
      if (!stat?.isDirectory()) return res.status(404).json({ error: "Project not found" });

      const detected = await detectProjectType(projectDir);
      const configFile = `ide-project-${subdomain}`;
      let port = null;
      let pmName = null;

      if (detected.type === "static") {
        const deployDir = path.join(DEPLOY_ROOT, subdomain);
        await fs.mkdir(deployDir, { recursive: true });
        await execAsync(`rsync -av --delete ${projectDir}/ ${deployDir}/`);
      } else if (detected.type === "node" || detected.type === "python") {
        port = await findFreePort();
        pmName = `ide-${subdomain}`;
        // Stop existing if any
        await execAsync(`${PM2} delete ${pmName} 2>/dev/null || true`);
        const cmd = detected.type === "node" ? "node" : "python3";
        const entryFile = detected.command.split(" ").pop();
        await execAsync(`cd ${projectDir} && PORT=${port} ${PM2} start ${entryFile} --name ${pmName} --interpreter ${cmd} -- --port ${port}`);
      } else {
        return res.status(400).json({ error: `Cannot deploy project type: ${detected.type}` });
      }

      // Write nginx config
      const nginxConf = generateNginxConfig(subdomain, detected.type, port);
      await execAsync(`echo ${JSON.stringify(nginxConf)} | sudo tee ${NGINX_SITES}/${configFile}`);
      await execAsync("sudo nginx -s reload");

      const url = `http://${subdomain}.${DOMAIN_SUFFIX}`;
      res.json({
        success: true,
        url,
        subdomain,
        type: detected.type,
        port,
        pmName,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Undeploy a project
  app.delete("/api/subdomain-deploy/:project", async (req, res) => {
    try {
      const subdomain = sanitize(req.params.project);
      const configFile = `ide-project-${subdomain}`;
      const configPath = path.join(NGINX_SITES, configFile);

      // Remove nginx config
      await execAsync(`sudo rm -f ${configPath}`);
      await execAsync("sudo nginx -s reload");

      // Stop PM2 process if any
      await execAsync(`${PM2} delete ide-${subdomain} 2>/dev/null || true`);

      // Remove static deploy dir
      await execAsync(`rm -rf ${DEPLOY_ROOT}/${subdomain}`);

      res.json({ success: true, message: `Undeployed ${subdomain}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
