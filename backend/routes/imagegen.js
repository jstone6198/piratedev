import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const router = Router();
const KEYS_PATH = '/home/claude-runner/config/llm-keys.json';
const ALLOWED_SIZES = new Set([
  '1024x1024',
  '1792x1024',
  '1024x1792',
]);

function safeProjectPath(workspaceDir, project, relativePath = '') {
  const projectDir = path.resolve(workspaceDir, project);
  const resolved = path.resolve(projectDir, relativePath);
  if (!resolved.startsWith(projectDir)) {
    return null;
  }
  return resolved;
}

function slugifyFilename(value) {
  return value
    .toLowerCase()
    .replace(/\.png$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildFilename(filename, prompt) {
  const supplied = slugifyFilename(path.basename(filename || ''));
  if (supplied) {
    return supplied;
  }

  const promptSlug = slugifyFilename(prompt);
  if (promptSlug) {
    return `${promptSlug.slice(0, 56)}-${Date.now()}`;
  }

  return `image-${Date.now()}`;
}

async function readOpenAiApiKey() {
  const raw = await fs.readFile(KEYS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  const openai = parsed?.openai;

  return openai?.api_key
    || openai?.apiKey
    || openai?.key
    || openai?.token
    || '';
}

async function requestGeneratedImage({ apiKey, prompt, size }) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      size,
      n: 1,
      response_format: 'b64_json',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  const image = payload?.data?.[0];
  if (image?.b64_json) {
    return Buffer.from(image.b64_json, 'base64');
  }

  if (image?.url) {
    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) {
      throw new Error(`Generated image download failed with status ${imageResponse.status}`);
    }
    return Buffer.from(await imageResponse.arrayBuffer());
  }

  throw new Error('OpenAI image response did not include image data');
}

router.post('/:project/generate', async (req, res) => {
  try {
    const workspaceDir = req.app.locals.workspaceDir;
    const { project } = req.params;
    const {
      prompt,
      width,
      height,
      filename,
    } = req.body ?? {};

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      return res.status(400).json({ error: 'width and height must be integers' });
    }

    const size = `${width}x${height}`;
    if (!ALLOWED_SIZES.has(size)) {
      return res.status(400).json({ error: `Unsupported image size: ${size}` });
    }

    const projectDir = safeProjectPath(workspaceDir, project);
    if (!projectDir) {
      return res.status(400).json({ error: 'Invalid project name' });
    }
    if (!existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const apiKey = await readOpenAiApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'OpenAI API key is not configured in llm-keys.json' });
    }

    const safeFilename = buildFilename(filename, prompt);
    const relativePath = path.posix.join('assets', `${safeFilename}.png`);
    const targetPath = safeProjectPath(workspaceDir, project, relativePath);
    if (!targetPath) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const imageBuffer = await requestGeneratedImage({
      apiKey,
      prompt: prompt.trim(),
      size,
    });

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, imageBuffer);

    const io = req.app.locals.io;
    if (io) {
      io.emit('file:changed', { project, file: relativePath });
    }

    res.json({
      path: relativePath,
      url: `/api/files/${encodeURIComponent(project)}?path=${encodeURIComponent(relativePath)}`,
    });
  } catch (error) {
    console.error('[imagegen] generate error:', error);
    res.status(500).json({ error: 'Failed to generate image', message: error.message });
  }
});

export default router;
