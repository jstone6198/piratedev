import React, { useState, useEffect } from 'react';
import './SettingsPanel.css';
import useSettings from '../hooks/useSettings';

const PROVIDERS = [
  { id:'codex', name:'Codex (GPT-5.4)', free:true, desc:'Free via PirateDev shared account' },
  { id:'claude-code', name:'Claude Sonnet (shared)', free:true, desc:'Free via PirateDev shared account' },
  { id:'openai', name:'OpenAI', models:['gpt-4o','gpt-4.1','gpt-4o-mini','o3','o4-mini'], cost:'~$2.50/1M tokens (GPT-4o)' },
  { id:'anthropic', name:'Anthropic', models:['claude-opus-4-6','claude-sonnet-4-6','claude-haiku-4-5-20251001'], cost:'~$3/1M tokens (Sonnet)' },
  { id:'google', name:'Google Gemini', models:['gemini-2.0-flash','gemini-2.5-pro'], cost:'~$0.075/1M tokens (Flash)' },
  { id:'groq', name:'Groq', models:['llama-3.3-70b-versatile','mixtral-8x7b-32768','deepseek-r1-distill-llama-70b'], cost:'~$0.59/1M tokens' },
  { id:'mistral', name:'Mistral', models:['mistral-large-latest','codestral-latest'], cost:'~$2/1M tokens' },
  { id:'custom', name:'Custom Endpoint', models:[], cost:'Your own inference server' },
];

const CONNECTORS = [
  { id:'stripe', name:'Stripe', icon:'\u{1F4B3}', fields:[{key:'STRIPE_SECRET_KEY',placeholder:'sk_live_...'}] },
  { id:'github', name:'GitHub', icon:'\u{1F419}', fields:[{key:'GITHUB_TOKEN',placeholder:'ghp_...'}] },
  { id:'slack', name:'Slack', icon:'\u{1F4AC}', fields:[{key:'SLACK_BOT_TOKEN',placeholder:'xoxb-...'}] },
  { id:'supabase', name:'Supabase', icon:'\u26A1', fields:[{key:'SUPABASE_URL',placeholder:'https://...'},{key:'SUPABASE_ANON_KEY',placeholder:'eyJ...'}] },
  { id:'openai', name:'OpenAI (project key)', icon:'\u{1F916}', fields:[{key:'OPENAI_API_KEY',placeholder:'sk-...'}] },
  { id:'anthropic', name:'Anthropic (project key)', icon:'\u{1F9E0}', fields:[{key:'ANTHROPIC_API_KEY',placeholder:'sk-ant-...'}] },
  { id:'twilio', name:'Twilio', icon:'\u{1F4F1}', fields:[{key:'TWILIO_ACCOUNT_SID',placeholder:'AC...'},{key:'TWILIO_AUTH_TOKEN',placeholder:'...'}] },
  { id:'resend', name:'Resend', icon:'\u2709\uFE0F', fields:[{key:'RESEND_API_KEY',placeholder:'re_...'}] },
  { id:'notion', name:'Notion', icon:'\u{1F4DD}', fields:[{key:'NOTION_API_KEY',placeholder:'secret_...'}] },
  { id:'discord', name:'Discord', icon:'\u{1F3AE}', fields:[{key:'DISCORD_BOT_TOKEN',placeholder:'...'}] },
];

const DEFAULT_EDITOR = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  formatOnSave: false,
  autoSave: true,
  theme: 'dark',
  keyBindings: 'default',
};

export default function SettingsPanel({ isOpen, onClose }) {
  const {
    settings, loading, error, toasts, dismissToast,
    updateLLM, deleteLLM, testLLM, updateConnector, updateEditor, exportSettings,
  } = useSettings();

  const [activeTab, setActiveTab] = useState('ai');
  const [keyVisibility, setKeyVisibility] = useState({});
  const [keyValues, setKeyValues] = useState({});
  const [modelSelections, setModelSelections] = useState({});
  const [testResults, setTestResults] = useState({});
  const [expandedConnector, setExpandedConnector] = useState(null);
  const [connectorFieldValues, setConnectorFieldValues] = useState({});
  const [editorLocal, setEditorLocal] = useState(DEFAULT_EDITOR);
  const [username, setUsername] = useState('');

  useEffect(() => {
    if (settings?.editorPrefs) {
      setEditorLocal({ ...DEFAULT_EDITOR, ...settings.editorPrefs });
    }
    if (settings?.username) {
      setUsername(settings.username);
    }
  }, [settings]);

  if (!isOpen) return null;

  const isConfigured = (providerId) => {
    return settings?.llmProviders?.[providerId]?.apiKey ? true : false;
  };

  const getMaskedKey = (providerId) => {
    return settings?.llmProviders?.[providerId]?.maskedKey || settings?.llmProviders?.[providerId]?.apiKey || '';
  };

  const handleTestProvider = async (providerId) => {
    setTestResults((prev) => ({ ...prev, [providerId]: { ok: null, msg: 'Testing...' } }));
    const result = await testLLM(providerId);
    setTestResults((prev) => ({ ...prev, [providerId]: { ok: result.success, msg: result.message } }));
  };

  const handleSaveProvider = (providerId) => {
    const data = {};
    if (keyValues[providerId]) data.apiKey = keyValues[providerId];
    if (modelSelections[providerId]) data.model = modelSelections[providerId];
    updateLLM(providerId, data);
    setKeyValues((prev) => ({ ...prev, [providerId]: '' }));
  };

  const handleSaveConnector = (connectorId) => {
    const fields = connectorFieldValues[connectorId] || {};
    updateConnector(connectorId, fields);
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const headers = { 'Content-Type': 'application/json' };
        const key = localStorage.getItem('piratedev_ide_key') || window.IDE_KEY;
        if (key) headers['x-ide-key'] = key;
        await fetch('/api/settings/import', { method: 'POST', headers, body: reader.result });
        window.location.reload();
      } catch { /* ignore */ }
    };
    reader.readAsText(file);
  };

  const navItems = [
    { id: 'ai', label: '\u2601 AI Models' },
    { id: 'connectors', label: '\u{1F50C} Connectors' },
    { id: 'editor', label: '\u270F Editor' },
    { id: 'account', label: '\u{1F464} Account' },
  ];

  const renderAITab = () => {
    const allProviderIds = PROVIDERS.map((p) => p.id);
    return (
      <>
        <p className="settings-section-title">Default Providers</p>
        <div className="use-for-row">
          <div className="use-for-group">
            <label>Chat</label>
            <select
              className="model-select"
              value={settings?.defaultProvider || 'codex'}
              onChange={(e) => updateLLM('_defaults', { defaultProvider: e.target.value })}
            >
              {allProviderIds.map((id) => <option key={id} value={id}>{PROVIDERS.find((p) => p.id === id)?.name}</option>)}
            </select>
          </div>
          <div className="use-for-group">
            <label>Agent</label>
            <select
              className="model-select"
              value={settings?.agentProvider || 'codex'}
              onChange={(e) => updateLLM('_defaults', { agentProvider: e.target.value })}
            >
              {allProviderIds.map((id) => <option key={id} value={id}>{PROVIDERS.find((p) => p.id === id)?.name}</option>)}
            </select>
          </div>
          <div className="use-for-group">
            <label>Completion</label>
            <select
              className="model-select"
              value={settings?.completionProvider || 'codex'}
              onChange={(e) => updateLLM('_defaults', { completionProvider: e.target.value })}
            >
              {allProviderIds.map((id) => <option key={id} value={id}>{PROVIDERS.find((p) => p.id === id)?.name}</option>)}
            </select>
          </div>
        </div>

        <p className="settings-section-title">Providers</p>
        {PROVIDERS.map((provider) => {
          const configured = isConfigured(provider.id);
          const testResult = testResults[provider.id];
          return (
            <div key={provider.id} className={`provider-card ${configured ? 'configured' : ''}`}>
              <div className="provider-header">
                <span className="provider-name">{provider.name}</span>
                {provider.free ? (
                  <span className="badge badge-free">FREE</span>
                ) : configured ? (
                  <span className="badge badge-configured">CONFIGURED</span>
                ) : (
                  <span className="badge badge-not-set">NOT SET</span>
                )}
              </div>

              {provider.free ? (
                <div className="free-label">{provider.desc}</div>
              ) : (
                <>
                  <div className="key-input-row">
                    <input
                      className="key-input"
                      type={keyVisibility[provider.id] ? 'text' : 'password'}
                      placeholder={getMaskedKey(provider.id) || 'API key...'}
                      value={keyValues[provider.id] || ''}
                      onChange={(e) => setKeyValues((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                    />
                    <button
                      className="btn-test"
                      onClick={() => setKeyVisibility((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                      title={keyVisibility[provider.id] ? 'Hide' : 'Show'}
                    >
                      {keyVisibility[provider.id] ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}'}
                    </button>
                  </div>

                  {provider.models && provider.models.length > 0 && (
                    <select
                      className="model-select"
                      value={modelSelections[provider.id] || settings?.llmProviders?.[provider.id]?.model || provider.models[0]}
                      onChange={(e) => setModelSelections((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                    >
                      {provider.models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}

                  {provider.id === 'custom' && (
                    <input
                      className="key-input"
                      style={{ marginBottom: 8 }}
                      placeholder="Base URL (OpenAI-compatible)"
                      value={keyValues[`${provider.id}_url`] || ''}
                      onChange={(e) => setKeyValues((prev) => ({ ...prev, [`${provider.id}_url`]: e.target.value }))}
                    />
                  )}

                  <div className="provider-actions">
                    <button className="btn-test" onClick={() => handleTestProvider(provider.id)}>Test</button>
                    <button className="btn-save" onClick={() => handleSaveProvider(provider.id)}>Save</button>
                    {configured && (
                      <button className="btn-test" onClick={() => deleteLLM(provider.id)} style={{ color: '#ea4a4a' }}>Remove</button>
                    )}
                    {testResult && (
                      <span className={`test-result ${testResult.ok ? 'ok' : testResult.ok === false ? 'err' : ''}`}>
                        {testResult.msg}
                      </span>
                    )}
                  </div>
                </>
              )}

              {provider.cost && <div className="provider-cost">{provider.cost}</div>}
            </div>
          );
        })}
      </>
    );
  };

  const renderConnectorsTab = () => (
    <>
      <p className="settings-section-title">Global Connectors</p>
      <div className="global-keys-note">
        Keys saved here are available across all projects. Project-level .env files override these.
      </div>
      <div className="connector-grid">
        {CONNECTORS.map((conn) => {
          const isActive = settings?.globalConnectors?.[conn.id];
          const isExpanded = expandedConnector === conn.id;
          return (
            <div key={conn.id} className="connector-card">
              <div className="connector-card-header">
                <div className="connector-icon-name">
                  <span className="connector-icon">{conn.icon}</span>
                  <span>{conn.name}</span>
                  <span className={`status-dot ${isActive ? 'active' : ''}`} />
                </div>
                <button
                  className="btn-edit"
                  onClick={() => setExpandedConnector(isExpanded ? null : conn.id)}
                >
                  {isExpanded ? 'Close' : 'Edit'}
                </button>
              </div>
              {isExpanded && (
                <div className="connector-edit-area">
                  {conn.fields.map((field) => (
                    <input
                      key={field.key}
                      className="key-input"
                      placeholder={field.placeholder}
                      value={connectorFieldValues[conn.id]?.[field.key] || ''}
                      onChange={(e) => setConnectorFieldValues((prev) => ({
                        ...prev,
                        [conn.id]: { ...prev[conn.id], [field.key]: e.target.value },
                      }))}
                    />
                  ))}
                  <button className="btn-save" onClick={() => handleSaveConnector(conn.id)}>Save</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  const renderEditorTab = () => (
    <>
      <p className="settings-section-title">Editor Preferences</p>

      <div className="slider-row">
        <span className="slider-label">Font Size</span>
        <input
          type="range" min={10} max={24}
          value={editorLocal.fontSize}
          onChange={(e) => setEditorLocal((prev) => ({ ...prev, fontSize: Number(e.target.value) }))}
        />
        <span className="slider-value">{editorLocal.fontSize}</span>
      </div>

      <div className="slider-row">
        <span className="slider-label">Tab Size</span>
        <div className="btn-group">
          {[2, 4].map((n) => (
            <button
              key={n}
              className={editorLocal.tabSize === n ? 'active' : ''}
              onClick={() => setEditorLocal((prev) => ({ ...prev, tabSize: n }))}
            >{n}</button>
          ))}
        </div>
      </div>

      <div className="toggle-row">
        <span className="toggle-label">Word Wrap</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={editorLocal.wordWrap} onChange={(e) => setEditorLocal((prev) => ({ ...prev, wordWrap: e.target.checked }))} />
          <span className="toggle-slider" />
        </label>
      </div>

      <div className="toggle-row">
        <span className="toggle-label">Minimap</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={editorLocal.minimap} onChange={(e) => setEditorLocal((prev) => ({ ...prev, minimap: e.target.checked }))} />
          <span className="toggle-slider" />
        </label>
      </div>

      <div className="toggle-row">
        <span className="toggle-label">Format on Save</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={editorLocal.formatOnSave} onChange={(e) => setEditorLocal((prev) => ({ ...prev, formatOnSave: e.target.checked }))} />
          <span className="toggle-slider" />
        </label>
      </div>

      <div className="toggle-row">
        <span className="toggle-label">Auto Save</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={editorLocal.autoSave} onChange={(e) => setEditorLocal((prev) => ({ ...prev, autoSave: e.target.checked }))} />
          <span className="toggle-slider" />
        </label>
      </div>

      <div className="slider-row">
        <span className="slider-label">Theme</span>
        <div className="btn-group">
          {['dark', 'light', 'high-contrast'].map((t) => (
            <button
              key={t}
              className={editorLocal.theme === t ? 'active' : ''}
              onClick={() => setEditorLocal((prev) => ({ ...prev, theme: t }))}
            >{t}</button>
          ))}
        </div>
      </div>

      <div className="slider-row">
        <span className="slider-label">Key Bindings</span>
        <div className="btn-group">
          {['default', 'vim', 'emacs'].map((k) => (
            <button
              key={k}
              className={editorLocal.keyBindings === k ? 'active' : ''}
              onClick={() => setEditorLocal((prev) => ({ ...prev, keyBindings: k }))}
            >{k}</button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <button className="btn-primary" onClick={() => updateEditor(editorLocal)}>Save Editor Preferences</button>
      </div>
    </>
  );

  const renderAccountTab = () => (
    <>
      <p className="settings-section-title">Account</p>

      <div className="setting-row">
        <label>Username</label>
        <div className="key-input-row">
          <input
            className="text-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Your display name"
          />
          <button className="btn-save" onClick={() => updateLLM('_account', { username })}>Save</button>
        </div>
      </div>

      <div className="setting-row">
        <label>License Key</label>
        <div className="key-input-row">
          <input className="text-input" placeholder="Enter license key..." />
          <button className="btn-save" onClick={() => alert('License activation coming soon')}>Activate</button>
        </div>
      </div>

      <p className="settings-section-title">Data</p>

      <div className="provider-actions" style={{ marginBottom: 16 }}>
        <button className="btn-primary" onClick={exportSettings}>Export Settings</button>
        <label className="btn-test" style={{ cursor: 'pointer' }}>
          Import
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
        </label>
      </div>

      <div className="danger-zone">
        <h3>Danger Zone</h3>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
          Reset all settings to defaults. This cannot be undone.
        </p>
        <button
          className="btn-danger"
          onClick={() => {
            if (window.confirm('Reset all settings to defaults? This cannot be undone.')) {
              alert('Coming soon');
            }
          }}
        >
          Reset All Settings
        </button>
      </div>
    </>
  );

  const renderContent = () => {
    if (loading) return <div style={{ color: '#666', padding: 40 }}>Loading settings...</div>;
    if (error) return <div style={{ color: '#ea4a4a', padding: 40 }}>Error: {error}</div>;
    switch (activeTab) {
      case 'ai': return renderAITab();
      case 'connectors': return renderConnectorsTab();
      case 'editor': return renderEditorTab();
      case 'account': return renderAccountTab();
      default: return null;
    }
  };

  return (
    <>
      <div className="settings-overlay" onClick={onClose}>
        <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="logo">{'\u2620'} {'</>'}</span>
              <h2>Settings</h2>
            </div>
            <button className="btn-close" onClick={onClose}>{'\u2715'}</button>
          </div>
          <div className="settings-body">
            <nav className="settings-nav">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  className={activeTab === item.id ? 'active' : ''}
                  onClick={() => setActiveTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="settings-content">
              {renderContent()}
            </div>
          </div>
        </div>
      </div>
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} onClick={() => dismissToast(t.id)}>
            <span>{t.msg}</span>
            <span style={{ cursor: 'pointer', marginLeft: 12 }}>{'\u2715'}</span>
          </div>
        ))}
      </div>
    </>
  );
}
