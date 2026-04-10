import React from 'react';
import { VscChromeClose, VscSettingsGear } from 'react-icons/vsc';
import { useSettings, updateSettings } from '../settings';

function Section({ title, children }) {
  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>{title}</h3>
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function ToggleField({ label, description, checked, onChange }) {
  return (
    <label className="settings-field settings-field-toggle">
      <div className="settings-field-copy">
        <span className="settings-field-label">{label}</span>
        <span className="settings-field-description">{description}</span>
      </div>
      <button
        type="button"
        className={`settings-toggle ${checked ? 'enabled' : ''}`}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-toggle-thumb" />
      </button>
    </label>
  );
}

function RangeField({ label, description, min, max, step = 1, value, onChange, unit = '' }) {
  return (
    <label className="settings-field">
      <div className="settings-field-copy">
        <span className="settings-field-label">{label}</span>
        <span className="settings-field-description">{description}</span>
      </div>
      <div className="settings-range-control">
        <input
          className="settings-range-input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="settings-range-value">
          {value}
          {unit}
        </span>
      </div>
    </label>
  );
}

function SelectField({ label, description, value, options, onChange }) {
  return (
    <label className="settings-field">
      <div className="settings-field-copy">
        <span className="settings-field-label">{label}</span>
        <span className="settings-field-description">{description}</span>
      </div>
      <select className="settings-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SettingsPanel({ isOpen, onClose }) {
  const settings = useSettings();

  if (!isOpen) return null;

  const updateSection = (section, changes) => {
    updateSettings((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...changes,
      },
    }));
  };

  return (
    <div className="modal-overlay settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="IDE settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-panel-header">
          <div>
            <div className="settings-panel-kicker">
              <VscSettingsGear />
              <span>Workspace Preferences</span>
            </div>
            <h2>Settings</h2>
            <p>Changes are saved locally in this browser.</p>
          </div>
          <button className="settings-close-btn" type="button" onClick={onClose} aria-label="Close settings">
            <VscChromeClose />
          </button>
        </div>

        <div className="settings-panel-body">
          <Section title="Editor">
            <RangeField
              label="Font size"
              description="Monaco editor font size."
              min={12}
              max={24}
              value={settings.editor.fontSize}
              unit="px"
              onChange={(value) => updateSection('editor', { fontSize: value })}
            />
            <SelectField
              label="Tab size"
              description="Indentation width used in the editor."
              value={String(settings.editor.tabSize)}
              options={[
                { value: '2', label: '2 spaces' },
                { value: '4', label: '4 spaces' },
              ]}
              onChange={(value) => updateSection('editor', { tabSize: Number(value) })}
            />
            <ToggleField
              label="Word wrap"
              description="Wrap long lines inside the editor viewport."
              checked={settings.editor.wordWrap}
              onChange={(value) => updateSection('editor', { wordWrap: value })}
            />
            <ToggleField
              label="Minimap"
              description="Show the code overview minimap."
              checked={settings.editor.minimap}
              onChange={(value) => updateSection('editor', { minimap: value })}
            />
            <ToggleField
              label="Line numbers"
              description="Display line numbers in the gutter."
              checked={settings.editor.lineNumbers}
              onChange={(value) => updateSection('editor', { lineNumbers: value })}
            />
          </Section>

          <Section title="AI">
            <SelectField
              label="Default engine"
              description="Preferred model provider for AI actions."
              value={settings.ai.defaultEngine}
              options={[
                { value: 'codex', label: 'Codex' },
                { value: 'claude', label: 'Claude' },
              ]}
              onChange={(value) => updateSection('ai', { defaultEngine: value })}
            />
            <ToggleField
              label="Include context by default"
              description="Send project context unless a prompt opts out."
              checked={settings.ai.includeContext}
              onChange={(value) => updateSection('ai', { includeContext: value })}
            />
            <ToggleField
              label="Auto-complete enabled"
              description="Allow inline AI completions in the editor."
              checked={settings.ai.autoComplete}
              onChange={(value) => updateSection('ai', { autoComplete: value })}
            />
            <RangeField
              label="Debounce delay"
              description="Delay before requesting inline completions."
              min={300}
              max={1000}
              step={50}
              value={settings.ai.debounceDelay}
              unit="ms"
              onChange={(value) => updateSection('ai', { debounceDelay: value })}
            />
          </Section>

          <Section title="Preview">
            <SelectField
              label="Default device"
              description="Initial device target for preview layout."
              value={settings.preview.defaultDevice}
              options={[
                { value: 'desktop', label: 'Desktop' },
                { value: 'tablet', label: 'Tablet' },
                { value: 'mobile', label: 'Mobile' },
              ]}
              onChange={(value) => updateSection('preview', { defaultDevice: value })}
            />
            <ToggleField
              label="Auto-reload on file change"
              description="Refresh preview automatically after file updates."
              checked={settings.preview.autoReloadOnFileChange}
              onChange={(value) => updateSection('preview', { autoReloadOnFileChange: value })}
            />
          </Section>

          <Section title="Terminal">
            <RangeField
              label="Font size"
              description="Terminal text size."
              min={12}
              max={20}
              value={settings.terminal.fontSize}
              unit="px"
              onChange={(value) => updateSection('terminal', { fontSize: value })}
            />
            <RangeField
              label="Scrollback lines"
              description="Maximum terminal history retained."
              min={500}
              max={5000}
              step={100}
              value={settings.terminal.scrollbackLines}
              onChange={(value) => updateSection('terminal', { scrollbackLines: value })}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
