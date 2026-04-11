import { execFile } from 'child_process';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'workspace', '_templates');

const TEMPLATE_DEFINITIONS = {
  'react-app': {
    name: 'react-app',
    title: 'React App',
    description: 'React + Vite starter with a minimal app shell.',
    language: 'javascript',
    icon: 'react',
  },
  'node-api': {
    name: 'node-api',
    title: 'Node API',
    description: 'Express API starter with route wiring and a server entrypoint.',
    language: 'javascript',
    icon: 'server',
  },
  'static-site': {
    name: 'static-site',
    title: 'Static Site',
    description: 'Vanilla HTML, CSS, and JavaScript for a fast static project.',
    language: 'html',
    icon: 'globe',
  },
  'python-flask': {
    name: 'python-flask',
    title: 'Python Flask',
    description: 'Flask starter with a rendered template and app bootstrap.',
    language: 'python',
    icon: 'flask',
  },
  'python-fastapi': {
    name: 'python-fastapi',
    title: 'Python FastAPI',
    description: 'FastAPI starter with a JSON endpoint and Uvicorn requirements.',
    language: 'python',
    icon: 'server',
    files: [
      {
        path: 'main.py',
        content: `from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}
`,
      },
      {
        path: 'requirements.txt',
        content: `fastapi
uvicorn[standard]
`,
      },
    ],
  },
  'python-django': {
    name: 'python-django',
    title: 'Python Django',
    description: 'Minimal Django project with a single response route.',
    language: 'python',
    icon: 'server',
    files: [
      {
        path: 'manage.py',
        content: `#!/usr/bin/env python3
import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
`,
      },
      {
        path: 'settings.py',
        content: `from django.http import HttpResponse
from django.urls import path

SECRET_KEY = "dev-secret-key"
DEBUG = True
ROOT_URLCONF = "settings"
ALLOWED_HOSTS = ["*"]
INSTALLED_APPS = []
MIDDLEWARE = []


def home(_request):
    return HttpResponse("Hello from Django")


urlpatterns = [
    path("", home),
]
`,
      },
      {
        path: 'requirements.txt',
        content: `django
`,
      },
    ],
  },
  'go-api': {
    name: 'go-api',
    title: 'Go API',
    description: 'Go HTTP API starter with a health endpoint.',
    language: 'go',
    icon: 'server',
    files: [
      {
        path: 'go.mod',
        content: `module go-api

go 1.22
`,
      },
      {
        path: 'main.go',
        content: `package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "Hello from Go"})
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
`,
      },
    ],
  },
  'go-web': {
    name: 'go-web',
    title: 'Go Web',
    description: 'Go web app starter using html/template.',
    language: 'go',
    icon: 'globe',
    files: [
      {
        path: 'go.mod',
        content: `module go-web

go 1.22
`,
      },
      {
        path: 'main.go',
        content: `package main

import (
	"html/template"
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	tmpl := template.Must(template.ParseFiles("templates/index.html"))

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		tmpl.Execute(w, map[string]string{"Title": "Go Web"})
	})

	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
`,
      },
      {
        path: 'templates/index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{.Title}}</title>
  </head>
  <body>
    <main>
      <h1>Hello from Go templates</h1>
      <p>Edit templates/index.html to get started.</p>
    </main>
  </body>
</html>
`,
      },
    ],
  },
  'rust-hello': {
    name: 'rust-hello',
    title: 'Rust Hello',
    description: 'Rust hello world starter with a single main file.',
    language: 'rust',
    icon: 'cube',
    files: [
      {
        path: 'main.rs',
        content: `fn main() {
    println!("Hello from Rust");
}
`,
      },
    ],
  },
  'rust-api': {
    name: 'rust-api',
    title: 'Rust API',
    description: 'Actix Web starter with a JSON-style health response.',
    language: 'rust',
    icon: 'server',
    files: [
      {
        path: 'Cargo.toml',
        content: `[package]
name = "rust-api"
version = "0.1.0"
edition = "2021"

[dependencies]
actix-web = "4"
`,
      },
      {
        path: 'src/main.rs',
        content: `use actix_web::{get, App, HttpResponse, HttpServer, Responder};

#[get("/")]
async fn index() -> impl Responder {
    HttpResponse::Ok().body("Hello from Actix Web")
}

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().body("{\\"status\\":\\"ok\\"}")
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| App::new().service(index).service(health))
        .bind(("0.0.0.0", 8080))?
        .run()
        .await
}
`,
      },
    ],
  },
  'php-basic': {
    name: 'php-basic',
    title: 'PHP Basic',
    description: 'PHP starter with a simple index page.',
    language: 'php',
    icon: 'globe',
    files: [
      {
        path: 'index.php',
        content: `<?php
$message = "Hello from PHP";
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PHP Basic</title>
  </head>
  <body>
    <main>
      <h1><?= htmlspecialchars($message) ?></h1>
      <p>Edit index.php to get started.</p>
    </main>
  </body>
</html>
`,
      },
    ],
  },
  'html-tailwind': {
    name: 'html-tailwind',
    title: 'HTML Tailwind',
    description: 'Static HTML starter using the Tailwind CDN.',
    language: 'html',
    icon: 'globe',
    files: [
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdn.tailwindcss.com"></script>
    <title>Tailwind Starter</title>
  </head>
  <body class="bg-zinc-950 text-zinc-50">
    <main class="min-h-screen px-6 py-16">
      <section class="mx-auto max-w-3xl">
        <p class="text-sm uppercase tracking-wide text-cyan-300">Tailwind CDN</p>
        <h1 class="mt-4 text-4xl font-bold">Build something sharp.</h1>
        <p class="mt-4 text-lg text-zinc-300">Edit index.html to get started.</p>
      </section>
    </main>
  </body>
</html>
`,
      },
    ],
  },
};

const router = Router();

router.get('/', async (req, res) => {
  try {
    const templatesDir = path.join(req.app.locals.workspaceDir, '_templates');

    const templatesByName = new Map(
      Object.entries(TEMPLATE_DEFINITIONS).map(([name, definition]) => [name, serializeTemplate(definition)])
    );

    if (fs.existsSync(templatesDir)) {
      const entries = await fs.promises.readdir(templatesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || templatesByName.has(entry.name)) continue;
        templatesByName.set(entry.name, {
          name: entry.name,
          title: formatTitle(entry.name),
          description: 'Custom starter template.',
          language: 'custom',
          icon: 'folder',
        });
      }
    }

    const templates = [...templatesByName.values()].sort((a, b) => a.title.localeCompare(b.title));

    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:templateName/create', async (req, res) => {
  try {
    const { templateName } = req.params;
    const { projectName } = req.body ?? {};

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const sanitizedProjectName = sanitizeProjectName(projectName);
    if (!sanitizedProjectName) {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    const workspaceDir = req.app.locals.workspaceDir;
    const templatesDir = path.join(workspaceDir, '_templates');
    const templateDir = path.resolve(templatesDir, templateName);

    const templateDefinition = TEMPLATE_DEFINITIONS[templateName];

    if (path.dirname(templateDir) !== templatesDir || (!fs.existsSync(templateDir) && !templateDefinition?.files)) {
      return res.status(404).json({ error: `Template "${templateName}" not found` });
    }

    const destinationDir = path.resolve(workspaceDir, sanitizedProjectName);
    if (path.dirname(destinationDir) !== workspaceDir) {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    if (fs.existsSync(destinationDir)) {
      return res.status(409).json({ error: 'Project already exists' });
    }

    if (fs.existsSync(templateDir)) {
      await copyDir(templateDir, destinationDir);
    } else {
      await writeTemplateFiles(templateDefinition.files, destinationDir);
    }
    await initializeGitRepo(destinationDir);

    res.status(201).json({
      ok: true,
      name: sanitizedProjectName,
      template: templateName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeProjectName(name) {
  const trimmed = String(name).trim();
  if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

function formatTitle(name) {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function serializeTemplate(template) {
  const { files: _files, ...metadata } = template;
  return metadata;
}

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
      continue;
    }

    await fs.promises.copyFile(srcPath, destPath);
  }
}

async function writeTemplateFiles(files, destinationDir) {
  await fs.promises.mkdir(destinationDir, { recursive: true });

  for (const file of files) {
    const destinationPath = path.resolve(destinationDir, file.path);
    if (path.isAbsolute(file.path) || (destinationPath !== destinationDir && !destinationPath.startsWith(`${destinationDir}${path.sep}`))) {
      throw new Error(`Invalid template file path: ${file.path}`);
    }

    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.promises.writeFile(destinationPath, file.content, 'utf-8');
  }
}

async function initializeGitRepo(projectDir) {
  try {
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectDir });
  } catch {
    await execFileAsync('git', ['init'], { cwd: projectDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: projectDir });
  }
}

export default router;
