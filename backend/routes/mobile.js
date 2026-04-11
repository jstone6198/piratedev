import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execFileAsync = promisify(execFile);
const KEYS_PATH = '/home/claude-runner/config/llm-keys.json';
const EXPO_DEPENDENCIES = {
  expo: '^52.0.0',
  'expo-router': '^4.0.0',
  react: '18.3.1',
  'react-native': '0.76.9',
  'react-native-safe-area-context': '^4.12.0',
  'react-native-screens': '^4.4.0',
};

function safeProjectDir(workspaceDir, project) {
  if (!workspaceDir || !project || project.includes('..') || path.isAbsolute(project)) {
    return null;
  }

  const workspace = path.resolve(workspaceDir);
  const projectDir = path.resolve(workspace, project);
  if (projectDir !== workspace && !projectDir.startsWith(`${workspace}${path.sep}`)) {
    return null;
  }

  return projectDir;
}

function toSlug(value) {
  return String(value || 'mobile-app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'mobile-app';
}

function hasExpoConfig(projectDir) {
  return existsSync(path.join(projectDir, 'app.json'))
    || existsSync(path.join(projectDir, 'app.config.js'));
}

async function ensureProject(req, res) {
  const projectDir = safeProjectDir(req.app.locals.workspaceDir, req.params.project);
  if (!projectDir) {
    res.status(400).json({ error: 'Invalid project name' });
    return null;
  }
  if (!existsSync(projectDir)) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return projectDir;
}

async function readJsonIfExists(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function expoAppJson(project) {
  const slug = toSlug(project);
  return {
    expo: {
      name: project,
      slug,
      version: '1.0.0',
      sdkVersion: '52.0.0',
      scheme: slug,
      orientation: 'portrait',
      icon: './assets/icon.png',
      splash: {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#1e1e1e',
      },
      assetBundlePatterns: ['**/*'],
      ios: {
        supportsTablet: true,
        bundleIdentifier: `com.${slug.replace(/-/g, '')}.app`,
      },
      android: {
        package: `com.${slug.replace(/-/g, '')}.app`,
        adaptiveIcon: {
          foregroundImage: './assets/icon.png',
          backgroundColor: '#1e1e1e',
        },
      },
      plugins: ['expo-router'],
      extra: {
        mobile: {
          devServerUrl: `exp://${getLocalAddress()}:8081`,
        },
      },
    },
  };
}

function appJsSource(project) {
  return `import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';

export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>${project}</Text>
        <Text style={styles.body}>Expo is ready for mobile publishing.</Text>
        <Link href="/" style={styles.link}>Open app route</Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e1e',
    padding: 24,
  },
  card: {
    gap: 12,
    alignItems: 'center',
  },
  title: {
    color: '#f0f0f0',
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    color: '#cfcfcf',
    fontSize: 16,
    textAlign: 'center',
  },
  link: {
    color: '#58a6ff',
    fontSize: 16,
  },
});
`;
}

function routeSource(project) {
  return `import React from 'react';
import { SafeAreaView, StyleSheet, Text } from 'react-native';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>${project}</Text>
      <Text style={styles.body}>Scan the Expo QR code to preview this app.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e1e',
    padding: 24,
  },
  title: {
    color: '#f0f0f0',
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    color: '#cfcfcf',
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
});
`;
}

function getLocalAddress() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return 'localhost';
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function makeQrDataUrl(url) {
  try {
    const qrResponse = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&format=svg&data=${encodeURIComponent(url)}`);
    if (qrResponse.ok) {
      const qrSvg = await qrResponse.text();
      return `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}`;
    }
  } catch {
    // Fall through to a readable fallback when the QR provider is unavailable.
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="380" viewBox="0 0 340 380">
  <rect width="340" height="380" fill="#f7f7f7"/>
  <rect x="24" y="24" width="292" height="292" fill="#fff" stroke="#111"/>
  <text x="170" y="156" fill="#111" font-family="Arial, sans-serif" font-size="18" text-anchor="middle">Expo URL</text>
  <text x="170" y="184" fill="#111" font-family="Arial, sans-serif" font-size="11" text-anchor="middle">${xmlEscape(url.slice(0, 44))}</text>
  <text x="170" y="344" fill="#111" font-family="Arial, sans-serif" font-size="14" text-anchor="middle">Scan with Expo Go</text>
  <text x="170" y="364" fill="#444" font-family="Arial, sans-serif" font-size="10" text-anchor="middle">${xmlEscape(url.slice(0, 52))}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function readExpoUrl(projectDir, req) {
  const appJsonPath = path.join(projectDir, 'app.json');
  const appJson = await readJsonIfExists(appJsonPath, {});
  const configured = appJson?.expo?.extra?.mobile?.devServerUrl
    || appJson?.expo?.hostUri
    || appJson?.expo?.updates?.url;

  if (typeof configured === 'string' && configured.trim()) {
    return configured.startsWith('exp://') ? configured : `exp://${configured.replace(/^https?:\/\//, '')}`;
  }

  const host = String(req.get('host') || '').split(':')[0] || getLocalAddress();
  return `exp://${host}:8081`;
}

async function readOpenAiApiKey() {
  const raw = await fs.readFile(KEYS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  const openai = parsed?.openai;
  return openai?.api_key || openai?.apiKey || openai?.key || openai?.token || '';
}

async function requestGeneratedImage({ apiKey, prompt }) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      size: '1024x1024',
      n: 1,
      response_format: 'b64_json',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI request failed with status ${response.status}`);
  }

  const image = payload?.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image?.url) {
    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) {
      throw new Error(`Generated image download failed with status ${imageResponse.status}`);
    }
    return Buffer.from(await imageResponse.arrayBuffer());
  }

  throw new Error('OpenAI image response did not include image data');
}

async function latestBuildMeta(projectDir) {
  const metaPath = path.join(projectDir, '.mobile-builds', 'latest.json');
  return readJsonIfExists(metaPath, null);
}

async function writeLatestBuildMeta(projectDir, meta) {
  const buildDir = path.join(projectDir, '.mobile-builds');
  await fs.mkdir(buildDir, { recursive: true });
  await writeJson(path.join(buildDir, 'latest.json'), meta);
}

async function readLogTail(logPath) {
  try {
    const content = await fs.readFile(logPath, 'utf-8');
    return content.slice(-12000);
  } catch {
    return '';
  }
}

function normalizeBuild(item = {}, fallback = {}) {
  return {
    status: String(item.status || fallback.status || 'unknown').toLowerCase(),
    platform: item.platform || fallback.platform || null,
    completedAt: item.completedAt || item.finishedAt || fallback.completedAt || null,
    artifactUrl: item.artifacts?.buildUrl || item.artifactUrl || item.apkUrl || item.ipaUrl || null,
    buildUrl: item.buildDetailsPageUrl || item.buildUrl || item.url || null,
  };
}

router.post('/:project/init', async (req, res) => {
  try {
    const projectDir = await ensureProject(req, res);
    if (!projectDir) return;

    const created = [];
    const appJsonPath = path.join(projectDir, 'app.json');
    const appJsPath = path.join(projectDir, 'App.js');
    const appRoutePath = path.join(projectDir, 'app', 'index.js');
    const packagePath = path.join(projectDir, 'package.json');

    if (!hasExpoConfig(projectDir)) {
      await writeJson(appJsonPath, expoAppJson(req.params.project));
      created.push('app.json');
    }

    if (!existsSync(appJsPath)) {
      await fs.writeFile(appJsPath, appJsSource(req.params.project), 'utf-8');
      created.push('App.js');
    }

    if (!existsSync(appRoutePath)) {
      await fs.mkdir(path.dirname(appRoutePath), { recursive: true });
      await fs.writeFile(appRoutePath, routeSource(req.params.project), 'utf-8');
      created.push('app/index.js');
    }

    const packageJson = await readJsonIfExists(packagePath, {
      name: toSlug(req.params.project),
      version: '1.0.0',
      private: true,
    });
    packageJson.main = packageJson.main || 'expo-router/entry';
    packageJson.scripts = {
      start: 'expo start',
      android: 'expo start --android',
      ios: 'expo start --ios',
      web: 'expo start --web',
      ...(packageJson.scripts || {}),
    };
    packageJson.dependencies = {
      ...(packageJson.dependencies || {}),
      ...Object.fromEntries(
        Object.entries(EXPO_DEPENDENCIES).filter(([name]) => !packageJson.dependencies?.[name]),
      ),
    };
    await writeJson(packagePath, packageJson);
    if (!created.includes('package.json')) created.push('package.json');

    const io = req.app.locals.io;
    if (io) {
      for (const file of created) io.emit('file:changed', { project: req.params.project, file });
    }

    res.json({ initialized: true, files: created });
  } catch (error) {
    console.error('[mobile] init error:', error);
    res.status(500).json({ error: 'Failed to initialize Expo project', message: error.message });
  }
});

router.get('/:project/qr', async (req, res) => {
  try {
    const projectDir = await ensureProject(req, res);
    if (!projectDir) return;
    if (!hasExpoConfig(projectDir)) {
      return res.status(404).json({ error: 'Expo config not found', configured: false });
    }

    const url = await readExpoUrl(projectDir, req);
    res.json({ qrCode: await makeQrDataUrl(url), url, configured: true });
  } catch (error) {
    console.error('[mobile] qr error:', error);
    res.status(500).json({ error: 'Failed to generate Expo QR code', message: error.message });
  }
});

router.post('/:project/build', async (req, res) => {
  try {
    const projectDir = await ensureProject(req, res);
    if (!projectDir) return;

    const platform = req.body?.platform || 'all';
    if (!['ios', 'android', 'all'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be ios, android, or all' });
    }

    const buildId = `build-${Date.now()}`;
    const buildDir = path.join(projectDir, '.mobile-builds');
    const logPath = path.join(buildDir, `${buildId}.log`);
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(logPath, `Starting EAS build for ${platform}\n`, 'utf-8');

    const relativeLog = path.relative(projectDir, logPath);
    await writeLatestBuildMeta(projectDir, {
      buildId,
      platform,
      status: 'building',
      startedAt: new Date().toISOString(),
      logFile: relativeLog,
    });

    const child = spawn('npx', ['eas', 'build', '--platform', platform, '--non-interactive'], {
      cwd: projectDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      fs.appendFile(logPath, data).catch(() => {});
    });
    child.stderr.on('data', (data) => {
      fs.appendFile(logPath, data).catch(() => {});
    });
    child.on('error', async (error) => {
      await fs.appendFile(logPath, `\nProcess error: ${error.message}\n`).catch(() => {});
      await writeLatestBuildMeta(projectDir, {
        buildId,
        platform,
        status: 'failed',
        completedAt: new Date().toISOString(),
        logFile: relativeLog,
        error: error.message,
      }).catch(() => {});
    });
    child.on('close', async (code) => {
      const status = code === 0 ? 'complete' : 'failed';
      await fs.appendFile(logPath, `\nEAS build exited with code ${code}\n`).catch(() => {});
      await writeLatestBuildMeta(projectDir, {
        buildId,
        platform,
        status,
        completedAt: new Date().toISOString(),
        logFile: relativeLog,
      }).catch(() => {});
    });

    res.json({
      buildId,
      status: 'building',
      logFile: relativeLog,
      log: await readLogTail(logPath),
    });
  } catch (error) {
    console.error('[mobile] build error:', error);
    res.status(500).json({ error: 'Failed to start EAS build', message: error.message });
  }
});

router.get('/:project/build-status', async (req, res) => {
  try {
    const projectDir = await ensureProject(req, res);
    if (!projectDir) return;

    const fallback = await latestBuildMeta(projectDir);
    let easBuild = null;
    try {
      const { stdout } = await execFileAsync('npx', ['eas', 'build:list', '--limit', '1', '--json', '--non-interactive'], {
        cwd: projectDir,
        env: process.env,
        maxBuffer: 1024 * 1024 * 4,
      });
      const parsed = JSON.parse(stdout);
      easBuild = Array.isArray(parsed) ? parsed[0] : parsed?.builds?.[0] || parsed;
    } catch (error) {
      if (!fallback) throw error;
    }

    const normalized = normalizeBuild(easBuild, fallback || {});
    const logPath = fallback?.logFile ? path.join(projectDir, fallback.logFile) : null;
    res.json({
      ...normalized,
      buildId: fallback?.buildId || easBuild?.id || null,
      logFile: fallback?.logFile || null,
      log: logPath ? await readLogTail(logPath) : '',
    });
  } catch (error) {
    console.error('[mobile] build-status error:', error);
    res.status(500).json({ error: 'Failed to check EAS build status', message: error.message });
  }
});

router.post('/:project/generate-assets', async (req, res) => {
  try {
    const projectDir = await ensureProject(req, res);
    if (!projectDir) return;

    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const apiKey = await readOpenAiApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'OpenAI API key is not configured in llm-keys.json' });
    }

    const assetsDir = path.join(projectDir, 'assets');
    await fs.mkdir(assetsDir, { recursive: true });

    const iconPrompt = `${prompt}. App icon, centered symbol, no text, clean mobile app icon, high contrast.`;
    const splashPrompt = `${prompt}. Mobile splash screen, centered app symbol, no text, clean background, high contrast.`;
    const [iconBuffer, splashBuffer] = await Promise.all([
      requestGeneratedImage({ apiKey, prompt: iconPrompt }),
      requestGeneratedImage({ apiKey, prompt: splashPrompt }),
    ]);

    await fs.writeFile(path.join(assetsDir, 'icon.png'), iconBuffer);
    await fs.writeFile(path.join(assetsDir, 'splash.png'), splashBuffer);

    const io = req.app.locals.io;
    if (io) {
      io.emit('file:changed', { project: req.params.project, file: 'assets/icon.png' });
      io.emit('file:changed', { project: req.params.project, file: 'assets/splash.png' });
    }

    res.json({
      icon: 'assets/icon.png',
      splash: 'assets/splash.png',
      iconUrl: `/api/files/${encodeURIComponent(req.params.project)}?path=${encodeURIComponent('assets/icon.png')}`,
      splashUrl: `/api/files/${encodeURIComponent(req.params.project)}?path=${encodeURIComponent('assets/splash.png')}`,
    });
  } catch (error) {
    console.error('[mobile] generate-assets error:', error);
    res.status(500).json({ error: 'Failed to generate mobile assets', message: error.message });
  }
});

router.get('/:project/store-guide', async (req, res) => {
  try {
    const projectDir = await ensureProject(req, res);
    if (!projectDir) return;

    res.json({
      guide: `# Mobile Store Submission Guide

## App Store
- Enroll in the Apple Developer Program.
- Configure bundle identifier, app name, SKU, category, age rating, and pricing in App Store Connect.
- Add app screenshots for required iPhone and iPad sizes.
- Provide app description, keywords, support URL, marketing URL, and privacy policy URL.
- Complete privacy nutrition labels and data collection answers.
- Run an iOS EAS build and upload the .ipa with EAS Submit or Transporter.
- Add review notes, demo account credentials if needed, and submit for review.

## Play Store
- Create a Google Play Developer account.
- Create the app listing with app name, short description, full description, category, tags, and contact details.
- Add phone screenshots, tablet screenshots if supported, feature graphic, app icon, and privacy policy URL.
- Complete Data Safety, content rating, target audience, ads declaration, and app access forms.
- Run an Android EAS build and upload the .aab or .apk to an internal test track first.
- Fix pre-launch report issues, promote to production, and submit for review.

## Checklist
- Screenshots for each supported device class.
- App icon and splash screen generated and configured.
- Production build signed by EAS credentials.
- Privacy policy URL published and reachable.
- Support email or support URL ready.
- Store descriptions, release notes, and keywords reviewed.
- Test account credentials prepared for reviewers when login is required.
- App permissions explained and matched to real app behavior.
`,
    });
  } catch (error) {
    console.error('[mobile] store-guide error:', error);
    res.status(500).json({ error: 'Failed to load store guide', message: error.message });
  }
});

export default router;
