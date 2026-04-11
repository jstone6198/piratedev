import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const router = Router();
const VALID_PROVIDERS = new Set(['google', 'github', 'email']);
const VALID_FRAMEWORKS = new Set(['express', 'nextjs', 'static']);

function getWorkspace(req) {
  return path.resolve(req.app.locals.workspaceDir);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveProjectDir(req) {
  const workspace = getWorkspace(req);
  const project = req.params.project;
  if (!project || project.includes('..') || path.isAbsolute(project)) return null;

  const projectDir = path.resolve(workspace, project);
  if (!projectDir.startsWith(workspace + path.sep) && projectDir !== workspace) return null;

  try {
    const stat = await fs.stat(projectDir);
    return stat.isDirectory() ? projectDir : null;
  } catch {
    return null;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function detectFramework(projectDir) {
  const packageJson = await readJson(path.join(projectDir, 'package.json'));
  const dependencies = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {}),
  };

  if (dependencies.next || await pathExists(path.join(projectDir, 'next.config.js')) || await pathExists(path.join(projectDir, 'next.config.mjs'))) {
    return 'nextjs';
  }

  if (dependencies.express || await pathExists(path.join(projectDir, 'server.js')) || await pathExists(path.join(projectDir, 'app.js'))) {
    return 'express';
  }

  return 'static';
}

function runNpmInstall(projectDir, packages) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', ...packages], { cwd: projectDir, env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || stdout || `npm install exited with code ${code}`));
      resolve();
    });
  });
}

async function ensurePackageJson(projectDir, project) {
  const packagePath = path.join(projectDir, 'package.json');
  if (await pathExists(packagePath)) return;

  await fs.writeFile(packagePath, `${JSON.stringify({
    name: project,
    version: '1.0.0',
    type: 'module',
  }, null, 2)}\n`, 'utf-8');
}

async function writeFile(projectDir, relativePath, content, files) {
  const target = path.join(projectDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf-8');
  files.push(relativePath);
}

async function mergeEnv(projectDir, relativePath, placeholders, files) {
  const target = path.join(projectDir, relativePath);
  let current = '';
  if (await pathExists(target)) {
    current = await fs.readFile(target, 'utf-8');
  }

  const lines = current.endsWith('\n') || current.length === 0 ? current : `${current}\n`;
  const additions = Object.entries(placeholders)
    .filter(([key]) => !new RegExp(`^${key}=`, 'm').test(current))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  if (additions) {
    await fs.writeFile(target, `${lines}${additions}\n`, 'utf-8');
    files.push(relativePath);
  }
}

function expressAuthRoutes(providers) {
  const oauthRoutes = providers
    .filter((provider) => provider === 'google' || provider === 'github')
    .map((provider) => `
router.get('/${provider}', passport.authenticate('${provider}', { scope: ${provider === 'google' ? "['profile', 'email']" : "['user:email']"} }));

router.get('/${provider}/callback',
  passport.authenticate('${provider}', { failureRedirect: '/auth/login' }),
  (_req, res) => res.redirect('/')
);
`)
    .join('\n');

  return `// Auth scaffold providers: ${providers.join(',')}
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import GitHubStrategy from 'passport-github2';
import { createUser, findUserByEmail, findUserById, findOrCreateOAuthUser } from '../models/user.js';

const router = Router();

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await findUserById(id));
  } catch (error) {
    done(error);
  }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback',
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || '';
      done(null, await findOrCreateOAuthUser('google', profile.id, email, profile.displayName));
    } catch (error) {
      done(error);
    }
  }));
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: '/auth/github/callback',
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || '';
      done(null, await findOrCreateOAuthUser('github', profile.id, email, profile.username));
    } catch (error) {
      done(error);
    }
  }));
}

router.get('/login', (_req, res) => res.sendFile(new URL('../views/login.html', import.meta.url).pathname));

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (await findUserByEmail(email)) return res.status(409).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({ email, passwordHash });
    req.login(user, (error) => {
      if (error) return next(error);
      return res.json({ success: true, user: { id: user.id, email: user.email } });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = email ? await findUserByEmail(email) : null;
    const valid = user?.passwordHash ? await bcrypt.compare(password || '', user.passwordHash) : false;
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    req.login(user, (error) => {
      if (error) return next(error);
      return res.json({ success: true, user: { id: user.id, email: user.email } });
    });
  } catch (error) {
    next(error);
  }
});
${oauthRoutes}
router.post('/logout', (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    res.json({ success: true });
  });
});

export default router;
`;
}

const expressMiddleware = `export function isAuthenticated(req, res, next) {
  if (req.isAuthenticated?.()) return next();
  return res.status(401).json({ error: 'Authentication required' });
}
`;

const expressUserModel = `import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const dataDir = path.resolve(process.cwd(), 'data');
const usersFile = path.join(dataDir, 'users.json');

async function readUsers() {
  try {
    return JSON.parse(await fs.readFile(usersFile, 'utf-8'));
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(usersFile, JSON.stringify(users, null, 2), 'utf-8');
}

export async function findUserById(id) {
  const users = await readUsers();
  return users.find((user) => user.id === id) || null;
}

export async function findUserByEmail(email) {
  const users = await readUsers();
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) || null;
}

export async function createUser(data) {
  const users = await readUsers();
  const user = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data };
  users.push(user);
  await writeUsers(users);
  return user;
}

export async function findOrCreateOAuthUser(provider, providerId, email, name) {
  const users = await readUsers();
  let user = users.find((entry) => entry.provider === provider && entry.providerId === providerId);
  if (user) return user;

  user = { id: crypto.randomUUID(), provider, providerId, email, name, createdAt: new Date().toISOString() };
  users.push(user);
  await writeUsers(users);
  return user;
}
`;

const expressLoginHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Login</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1e1e1e; color: #f0f0f0; font-family: system-ui, sans-serif; }
      form { width: min(360px, calc(100vw - 32px)); display: grid; gap: 12px; }
      input, button, a { border-radius: 8px; }
      input { background: #1e1e1e; border: 1px solid #333; color: #f0f0f0; padding: 12px; }
      button, a { border: 1px solid #333; background: #2b2b2b; color: #f0f0f0; padding: 12px; text-align: center; text-decoration: none; cursor: pointer; }
      h1 { margin: 0 0 8px; font-size: 24px; }
    </style>
  </head>
  <body>
    <form method="post" action="/auth/login">
      <h1>Sign in</h1>
      <input name="email" type="email" placeholder="Email" autocomplete="email" required />
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
      <a href="/auth/google">Continue with Google</a>
      <a href="/auth/github">Continue with GitHub</a>
    </form>
  </body>
</html>
`;

function nextAuthRoute(selectedProviders) {
  const nextProviders = [];
  if (selectedProviders.includes('google')) {
    nextProviders.push('GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })');
  }
  if (selectedProviders.includes('github')) {
    nextProviders.push('GitHubProvider({ clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET })');
  }
  if (selectedProviders.includes('email')) {
    nextProviders.push(`CredentialsProvider({
      name: 'Email',
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        return { id: credentials.email, email: credentials.email };
      },
    })`);
  }

  return `// Auth scaffold providers: ${selectedProviders.join(',')}
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';

const handler = NextAuth({
  providers: [
    ${nextProviders.join(',\n    ')}
  ],
});

export { handler as GET, handler as POST };
`;
}

const nextMiddleware = `export { default } from 'next-auth/middleware';

export const config = {
  matcher: ['/dashboard/:path*', '/account/:path*'],
};
`;

const staticAuthJs = `// Auth scaffold providers: google,github,email
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';

const firebaseConfig = window.FIREBASE_CONFIG || {};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function signInWithGitHub() {
  return signInWithPopup(auth, new GithubAuthProvider());
}

export function registerWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}
`;

const staticLoginHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Login</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1e1e1e; color: #f0f0f0; font-family: system-ui, sans-serif; }
      main { width: min(360px, calc(100vw - 32px)); display: grid; gap: 12px; }
      input, button { border-radius: 8px; }
      input { background: #1e1e1e; border: 1px solid #333; color: #f0f0f0; padding: 12px; }
      button { border: 1px solid #333; background: #2b2b2b; color: #f0f0f0; padding: 12px; cursor: pointer; }
      h1 { margin: 0 0 8px; font-size: 24px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Sign in</h1>
      <input id="email" type="email" placeholder="Email" autocomplete="email" />
      <input id="password" type="password" placeholder="Password" autocomplete="current-password" />
      <button id="login">Sign in with email</button>
      <button id="register">Create account</button>
      <button id="google">Continue with Google</button>
      <button id="github">Continue with GitHub</button>
    </main>
    <script type="module">
      import { loginWithEmail, registerWithEmail, signInWithGoogle, signInWithGitHub } from './auth.js';
      const email = document.getElementById('email');
      const password = document.getElementById('password');
      document.getElementById('login').onclick = () => loginWithEmail(email.value, password.value);
      document.getElementById('register').onclick = () => registerWithEmail(email.value, password.value);
      document.getElementById('google').onclick = () => signInWithGoogle();
      document.getElementById('github').onclick = () => signInWithGitHub();
    </script>
  </body>
</html>
`;

async function scaffoldExpress(projectDir, project, providers) {
  const files = [];
  await ensurePackageJson(projectDir, project);
  await runNpmInstall(projectDir, ['passport', 'passport-google-oauth20', 'passport-github2', 'express-session', 'bcryptjs']);
  await writeFile(projectDir, 'routes/auth.js', expressAuthRoutes(providers), files);
  await writeFile(projectDir, 'middleware/auth.js', expressMiddleware, files);
  await writeFile(projectDir, 'models/user.js', expressUserModel, files);
  await writeFile(projectDir, 'views/login.html', expressLoginHtml, files);
  await mergeEnv(projectDir, '.env', {
    GOOGLE_CLIENT_ID: 'your_id',
    GOOGLE_CLIENT_SECRET: 'your_secret',
    GITHUB_CLIENT_ID: 'your_id',
    GITHUB_CLIENT_SECRET: 'your_secret',
    SESSION_SECRET: 'change_me',
  }, files);

  return {
    files,
    instructions: 'Import routes/auth.js, express-session, and passport in your Express entry file. Mount the router at /auth, call app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false })), app.use(passport.initialize()), and app.use(passport.session()). Fill in OAuth credentials in .env before using Google or GitHub login.',
  };
}

async function scaffoldNext(projectDir, providers) {
  const files = [];
  await runNpmInstall(projectDir, ['next-auth']);
  await writeFile(projectDir, 'app/api/auth/[...nextauth]/route.js', nextAuthRoute(providers), files);
  await writeFile(projectDir, 'middleware.ts', nextMiddleware, files);
  await mergeEnv(projectDir, '.env.local', {
    NEXTAUTH_SECRET: 'change_me',
    NEXTAUTH_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'your_id',
    GOOGLE_CLIENT_SECRET: 'your_secret',
    GITHUB_CLIENT_ID: 'your_id',
    GITHUB_CLIENT_SECRET: 'your_secret',
  }, files);

  return {
    files,
    instructions: 'Fill in .env.local, restart the Next.js dev server, and protect additional routes by editing middleware.ts matcher entries.',
  };
}

async function scaffoldStatic(projectDir) {
  const files = [];
  await writeFile(projectDir, 'auth.js', staticAuthJs, files);
  await writeFile(projectDir, 'login.html', staticLoginHtml, files);
  await mergeEnv(projectDir, '.env', {
    FIREBASE_CONFIG: 'paste_firebase_web_config_here',
  }, files);

  return {
    files,
    instructions: 'Create a Firebase project, enable Authentication providers, paste the web config into your app as window.FIREBASE_CONFIG before loading auth.js, and serve login.html from the same directory.',
  };
}

async function getStatus(projectDir) {
  const framework = await detectFramework(projectDir);
  const checks = [
    ['routes/auth.js', 'express'],
    ['middleware/auth.js', 'express'],
    ['models/user.js', 'express'],
    ['views/login.html', 'express'],
    ['app/api/auth/[...nextauth]/route.js', 'nextjs'],
    ['middleware.ts', 'nextjs'],
    ['auth.js', 'static'],
    ['login.html', 'static'],
  ];

  const found = [];
  for (const [relativePath, owner] of checks) {
    if (await pathExists(path.join(projectDir, relativePath))) {
      found.push({ relativePath, owner });
    }
  }

  let provider = null;
  const authFiles = ['routes/auth.js', 'app/api/auth/[...nextauth]/route.js', 'auth.js'];
  for (const relativePath of authFiles) {
    const target = path.join(projectDir, relativePath);
    if (!await pathExists(target)) continue;
    const content = await fs.readFile(target, 'utf-8');
    const marker = content.match(/Auth scaffold providers:\s*([a-z,\s]+)/i);
    if (marker?.[1]) provider = marker[1].split(',').map((item) => item.trim()).find(Boolean) || null;
    else if (content.includes('Google')) provider = 'google';
    else if (content.includes('GitHub') || content.includes('Github')) provider = 'github';
    else if (content.includes('Credentials') || content.includes('Email')) provider = 'email';
    if (provider) break;
  }

  return {
    hasAuth: found.length > 0,
    provider,
    framework: found[0]?.owner || framework,
  };
}

async function handleAdd(req, res) {
  try {
    const projectDir = await resolveProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const providers = Array.isArray(req.body?.providers) && req.body.providers.length > 0
      ? req.body.providers
      : [req.body?.provider || 'email'];
    const framework = req.body?.framework || await detectFramework(projectDir);

    if (providers.some((provider) => !VALID_PROVIDERS.has(provider))) return res.status(400).json({ error: 'provider must be google, github, or email' });
    if (!VALID_FRAMEWORKS.has(framework)) return res.status(400).json({ error: 'framework must be express, nextjs, or static' });

    const result = framework === 'express'
      ? await scaffoldExpress(projectDir, req.params.project, providers)
      : framework === 'nextjs'
        ? await scaffoldNext(projectDir, providers)
        : await scaffoldStatic(projectDir);

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[auth-scaffold] add error:', error);
    return res.status(500).json({ error: 'Failed to scaffold auth', message: error.message });
  }
}

async function handleStatus(req, res) {
  try {
    const projectDir = await resolveProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    return res.json(await getStatus(projectDir));
  } catch (error) {
    console.error('[auth-scaffold] status error:', error);
    return res.status(500).json({ error: 'Failed to check auth status', message: error.message });
  }
}

router.post('/:project/add', handleAdd);
router.get('/:project/status', handleStatus);
router.post('/api/auth-scaffold/:project/add', handleAdd);
router.get('/api/auth-scaffold/:project/status', handleStatus);

export default router;
