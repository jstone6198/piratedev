import { useSyncExternalStore } from 'react';

export const SETTINGS_STORAGE_KEY = 'ide-settings';

export const DEFAULT_SETTINGS = {
  editor: {
    fontSize: 14,
    tabSize: 2,
    wordWrap: true,
    minimap: true,
    lineNumbers: true,
  },
  ai: {
    defaultEngine: 'codex',
    includeContext: true,
    autoComplete: true,
    debounceDelay: 500,
  },
  preview: {
    defaultDevice: 'desktop',
    autoReloadOnFileChange: true,
  },
  terminal: {
    fontSize: 14,
    scrollbackLines: 2000,
  },
};

const listeners = new Set();
let cachedSettings = DEFAULT_SETTINGS;
let hasLoadedSettings = false;

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeSettings(settings = {}) {
  return {
    editor: {
      fontSize: clamp(settings.editor?.fontSize, 12, 24, DEFAULT_SETTINGS.editor.fontSize),
      tabSize: settings.editor?.tabSize === 4 ? 4 : 2,
      wordWrap: typeof settings.editor?.wordWrap === 'boolean' ? settings.editor.wordWrap : DEFAULT_SETTINGS.editor.wordWrap,
      minimap: typeof settings.editor?.minimap === 'boolean' ? settings.editor.minimap : DEFAULT_SETTINGS.editor.minimap,
      lineNumbers: typeof settings.editor?.lineNumbers === 'boolean' ? settings.editor.lineNumbers : DEFAULT_SETTINGS.editor.lineNumbers,
    },
    ai: {
      defaultEngine: settings.ai?.defaultEngine === 'claude' ? 'claude' : 'codex',
      includeContext: typeof settings.ai?.includeContext === 'boolean' ? settings.ai.includeContext : DEFAULT_SETTINGS.ai.includeContext,
      autoComplete: typeof settings.ai?.autoComplete === 'boolean' ? settings.ai.autoComplete : DEFAULT_SETTINGS.ai.autoComplete,
      debounceDelay: clamp(settings.ai?.debounceDelay, 300, 1000, DEFAULT_SETTINGS.ai.debounceDelay),
    },
    preview: {
      defaultDevice: ['desktop', 'tablet', 'mobile'].includes(settings.preview?.defaultDevice)
        ? settings.preview.defaultDevice
        : DEFAULT_SETTINGS.preview.defaultDevice,
      autoReloadOnFileChange:
        typeof settings.preview?.autoReloadOnFileChange === 'boolean'
          ? settings.preview.autoReloadOnFileChange
          : DEFAULT_SETTINGS.preview.autoReloadOnFileChange,
    },
    terminal: {
      fontSize: clamp(settings.terminal?.fontSize, 12, 20, DEFAULT_SETTINGS.terminal.fontSize),
      scrollbackLines: clamp(settings.terminal?.scrollbackLines, 500, 5000, DEFAULT_SETTINGS.terminal.scrollbackLines),
    },
  };
}

export function getSettings() {
  if (!isBrowser()) return cachedSettings;

  if (hasLoadedSettings) {
    return cachedSettings;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    cachedSettings = raw ? sanitizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch (error) {
    console.error('Failed to read IDE settings:', error);
    cachedSettings = DEFAULT_SETTINGS;
  }

  hasLoadedSettings = true;
  return cachedSettings;
}

function emitSettingsChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function setSettings(nextSettings) {
  const resolvedSettings = sanitizeSettings(nextSettings);
  cachedSettings = resolvedSettings;
  hasLoadedSettings = true;

  if (isBrowser()) {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(resolvedSettings));
    } catch (error) {
      console.error('Failed to save IDE settings:', error);
    }
  }

  emitSettingsChange();
  return resolvedSettings;
}

export function updateSettings(updater) {
  const currentSettings = getSettings();
  const nextSettings =
    typeof updater === 'function'
      ? updater(currentSettings)
      : {
          ...currentSettings,
          ...updater,
        };

  return setSettings(nextSettings);
}

function subscribe(listener) {
  listeners.add(listener);

  if (isBrowser()) {
    const handleStorage = (event) => {
      if (event.key === SETTINGS_STORAGE_KEY) {
        hasLoadedSettings = false;
        listener();
      }
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', handleStorage);
    };
  }

  return () => {
    listeners.delete(listener);
  };
}

export function useSettings() {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
}
