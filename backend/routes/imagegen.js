import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const router = Router();
const KEYS_PATH = '/home/claude-runner/config/llm-keys.json';

const PROVIDERS = {
  grok: {
    name: 'Grok (xAI)',
    endpoint: 'https://api.x.ai/v1/images/generations',
    model: 'grok-imagine-image',
    keyPath: ['grok', 'api_key'],
    sizes: ['1024x1024', '1024x768', '768x1024'],
    responseFormat: 'url',
  },
  openai: {
    name: 'OpenAI (DALL-E 3)',
    endpoint: 'https://api.openai.com/v1/images/generations',
    model: 'dall-e-3',
    keyPath: ['openai', 'api_key'],
    sizes: ['1024x1024', '1792x1024', '1024x1792'],
    responseFormat: 'b64_json',
  },
  openrouter: {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/images/generations',
    model: 'dall-e-3',
    keyPath: ['openrouter', 'api_key'],
    sizes: ['1024x1024', '1792x1024', '1024x1792'],
    responseFormat: 'b64_json',
  },
};

function safeProjectPath(workspaceDir, project, relativePath = '') {
  const projectDir = path.resolve(workspaceDir, project);
  const resolved = path.resolve(projectDir, relativePath);
  if (!resolved.startsWith(projectDir)) return null;
  return resolved;
}

function slugifyFilename(value) {
  return value.toLowerCase().replace(/\.png$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function buildFilename(filename, prompt) {
  const supplied = slugifyFilename(path.basename(filename || ''));
  if (supplied) return supplied;
  const promptSlug = slugifyFilename(prompt);
  if (promptSlug) return `${promptSlug.slice(0, 56)}-${Date.now()}`;
  return `image-${Date.now()}`;
}

async function readKeys() {
  try {
    const raw = await fs.readFile(KEYS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch { return {}; }
}

function getApiKey(keys, provider) {
  // Check provider-specific key first
  const prov = PROVIDERS[provider];
  if (!prov) return '';
  let obj = keys;
  for (const segment of prov.keyPath) {
    obj = obj?.[segment];
  }
  if (obj) return String(obj);
  // Fallback: check common key names
  const section = keys?.[provider];
  return section?.api_key || section?.apiKey || section?.key || section?.token || '';
}

async function requestGeneratedImage({ apiKey, prompt, size, provider }) {
  const prov = PROVIDERS[provider];
  const body = {
    model: prov.model,
    prompt,
    n: 1,
  };

  // Grok does NOT support size or response_format params
  if (provider === 'grok') {
    // Grok returns URL by default, no size param supported
  } else {
    body.size = size;
    body.response_format = prov.responseFormat;
  }

  const response = await fetch(prov.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `${prov.name} request failed with status ${response.status}`;
    throw new Error(message);
  }

  const image = payload?.data?.[0];
  if (image?.b64_json) {
    return Buffer.from(image.b64_json, 'base64');
  }
  if (image?.url) {
    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) throw new Error(`Image download failed: ${imageResponse.status}`);
    return Buffer.from(await imageResponse.arrayBuffer());
  }
  throw new Error(`${prov.name} response did not include image data`);
}

// GET /imagegen/providers - returns available providers with keys configured
router.get('/providers', async (req, res) => {
  try {
    const keys = await readKeys();
    const available = [];
    for (const [id, prov] of Object.entries(PROVIDERS)) {
      const hasKey = Boolean(getApiKey(keys, id));
      available.push({
        id,
        name: prov.name,
        hasKey,
        sizes: prov.sizes,
      });
    }
    // Also check for custom keys
    available.push({ id: 'custom', name: 'Custom API Key', hasKey: false, sizes: ['1024x1024', '1792x1024', '1024x1792'] });
    res.json({ providers: available });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read provider config' });
  }
});

// POST /imagegen/:project/generate
router.post('/:project/generate', async (req, res) => {
  try {
    const workspaceDir = req.app.locals.workspaceDir;
    const { project } = req.params;
    const { prompt, width, height, filename, provider = 'grok', customApiKey, customEndpoint } = req.body ?? {};

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      return res.status(400).json({ error: 'width and height must be integers' });
    }

    const size = `${width}x${height}`;
    const projectDir = safeProjectPath(workspaceDir, project);
    if (!projectDir || !existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let apiKey;
    let effectiveProvider = provider;

    if (provider === 'custom' && customApiKey) {
      apiKey = customApiKey;
      effectiveProvider = 'openai'; // Custom keys use OpenAI-compatible format
    } else {
      if (!PROVIDERS[provider]) {
        return res.status(400).json({ error: `Unknown provider: ${provider}` });
      }
      const keys = await readKeys();
      apiKey = getApiKey(keys, provider);
      if (!apiKey) {
        return res.status(500).json({ error: `${PROVIDERS[provider].name} API key is not configured in llm-keys.json` });
      }
    }

    const safeFilename = buildFilename(filename, prompt);
    const relativePath = path.posix.join('assets', `${safeFilename}.png`);
    const targetPath = safeProjectPath(workspaceDir, project, relativePath);
    if (!targetPath) return res.status(400).json({ error: 'Invalid filename' });

    const imageBuffer = await requestGeneratedImage({
      apiKey,
      prompt: prompt.trim(),
      size,
      provider: effectiveProvider,
    });

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, imageBuffer);

    const io = req.app.locals.io;
    if (io) io.emit('file:changed', { project, file: relativePath });

    res.json({
      path: relativePath,
      url: `/api/files/${encodeURIComponent(project)}?path=${encodeURIComponent(relativePath)}`,
      provider: effectiveProvider,
    });
  } catch (error) {
    console.error('[imagegen] generate error:', error);
    res.status(500).json({ error: 'Failed to generate image', message: error.message });
  }
});

export default router;
