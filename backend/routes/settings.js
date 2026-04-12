import { Router } from 'express';
import { readVault, writeVault, maskVault } from '../services/user-vault.js';
import { callLLM } from '../services/llm-router.js';

const router = Router();

// GET /api/settings — return masked vault
router.get('/', (_req, res) => {
  try {
    const vault = readVault('default');
    res.json(maskVault(vault));
  } catch (err) {
    console.error('[settings] read failed:', err.message);
    res.status(500).json({ error: 'Failed to read settings', message: err.message });
  }
});

// PUT /api/settings/llm/:provider — save LLM provider config
router.put('/llm/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    const { apiKey, model, enabled } = req.body;
    const vault = readVault('default');
    vault.llmProviders[provider] = {
      ...vault.llmProviders[provider],
      ...(apiKey !== undefined && { apiKey }),
      ...(model !== undefined && { model }),
      ...(enabled !== undefined && { enabled }),
    };
    writeVault('default', vault);
    res.json({ ok: true, provider });
  } catch (err) {
    console.error('[settings] llm save failed:', err.message);
    res.status(500).json({ error: 'Failed to save LLM provider', message: err.message });
  }
});

// DELETE /api/settings/llm/:provider — remove LLM provider
router.delete('/llm/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    const vault = readVault('default');
    delete vault.llmProviders[provider];
    writeVault('default', vault);
    res.json({ ok: true, provider });
  } catch (err) {
    console.error('[settings] llm delete failed:', err.message);
    res.status(500).json({ error: 'Failed to delete LLM provider', message: err.message });
  }
});

// POST /api/settings/llm/:provider/test — validate API key
router.post('/llm/:provider/test', async (req, res) => {
  try {
    const { provider } = req.params;
    const vault = readVault('default');
    const providerConfig = vault.llmProviders[provider];

    if (!providerConfig || !providerConfig.apiKey) {
      return res.status(400).json({ success: false, message: `No API key configured for ${provider}` });
    }

    const testMessages = [{ role: 'user', content: 'Say "ok" and nothing else.' }];

    const defaultModels = {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-haiku-20240307',
      google: 'gemini-1.5-flash',
      groq: 'llama-3.1-8b-instant',
      mistral: 'mistral-small-latest',
    };

    await callLLM({
      provider,
      model: providerConfig.model || defaultModels[provider] || 'gpt-4o-mini',
      apiKey: providerConfig.apiKey,
      messages: testMessages,
      maxTokens: 10,
      temperature: 0,
      baseUrl: providerConfig.baseUrl,
    });

    res.json({ success: true, message: `${provider} API key is valid` });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// PUT /api/settings/defaults — save default/agent/completion provider selections
router.put('/defaults', (req, res) => {
  try {
    const { defaultProvider, agentProvider, completionProvider } = req.body;
    const vault = readVault('default');
    if (defaultProvider !== undefined) vault.defaultProvider = defaultProvider;
    if (agentProvider !== undefined) vault.agentProvider = agentProvider;
    if (completionProvider !== undefined) vault.completionProvider = completionProvider;
    writeVault('default', vault);
    res.json({ ok: true, defaultProvider: vault.defaultProvider, agentProvider: vault.agentProvider, completionProvider: vault.completionProvider });
  } catch (err) {
    console.error('[settings] defaults save failed:', err.message);
    res.status(500).json({ error: 'Failed to save defaults', message: err.message });
  }
});

// PUT /api/settings/connectors/:id — save global connector
router.put('/connectors/:id', (req, res) => {
  try {
    const { id } = req.params;
    const vault = readVault('default');
    vault.globalConnectors[id] = { ...vault.globalConnectors[id], ...req.body };
    writeVault('default', vault);
    res.json({ ok: true, connector: id });
  } catch (err) {
    console.error('[settings] connector save failed:', err.message);
    res.status(500).json({ error: 'Failed to save connector', message: err.message });
  }
});

// DELETE /api/settings/connectors/:id — remove global connector
router.delete('/connectors/:id', (req, res) => {
  try {
    const { id } = req.params;
    const vault = readVault('default');
    delete vault.globalConnectors[id];
    writeVault('default', vault);
    res.json({ ok: true, connector: id });
  } catch (err) {
    console.error('[settings] connector delete failed:', err.message);
    res.status(500).json({ error: 'Failed to delete connector', message: err.message });
  }
});

// PUT /api/settings/editor — save editor preferences
router.put('/editor', (req, res) => {
  try {
    const vault = readVault('default');
    vault.editorPrefs = { ...vault.editorPrefs, ...req.body };
    writeVault('default', vault);
    res.json({ ok: true, editorPrefs: vault.editorPrefs });
  } catch (err) {
    console.error('[settings] editor save failed:', err.message);
    res.status(500).json({ error: 'Failed to save editor prefs', message: err.message });
  }
});

// PUT /api/settings/ide — save IDE preferences
router.put('/ide', (req, res) => {
  try {
    const vault = readVault('default');
    vault.idePrefs = { ...vault.idePrefs, ...req.body };
    writeVault('default', vault);
    res.json({ ok: true, idePrefs: vault.idePrefs });
  } catch (err) {
    console.error('[settings] ide save failed:', err.message);
    res.status(500).json({ error: 'Failed to save IDE prefs', message: err.message });
  }
});

// GET /api/settings/export — download masked vault as JSON
router.get('/export', (_req, res) => {
  try {
    const vault = readVault('default');
    const masked = maskVault(vault);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="piratedev-settings.json"');
    res.json(masked);
  } catch (err) {
    console.error('[settings] export failed:', err.message);
    res.status(500).json({ error: 'Failed to export settings', message: err.message });
  }
});

// POST /api/settings/import — import vault JSON (llmProviders and globalConnectors only)
router.post('/import', (req, res) => {
  try {
    const imported = req.body;
    if (!imported || typeof imported !== 'object') {
      return res.status(400).json({ error: 'Invalid import data' });
    }
    const vault = readVault('default');
    if (imported.llmProviders) {
      vault.llmProviders = { ...vault.llmProviders, ...imported.llmProviders };
    }
    if (imported.globalConnectors) {
      vault.globalConnectors = { ...vault.globalConnectors, ...imported.globalConnectors };
    }
    writeVault('default', vault);
    res.json({ ok: true, message: 'Settings imported' });
  } catch (err) {
    console.error('[settings] import failed:', err.message);
    res.status(500).json({ error: 'Failed to import settings', message: err.message });
  }
});

export default router;
