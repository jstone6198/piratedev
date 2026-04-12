import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../api';

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const key = localStorage.getItem('piratedev_ide_key') || window.IDE_KEY;
  if (key) headers['x-ide-key'] = key;
  return headers;
}

export default function useSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const addToast = useCallback((msg, type = 'info') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/settings`, { headers: getHeaders() });
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      setSettings(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateLLM = useCallback(async (provider, data) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/llm/${provider}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to save LLM config');
      const result = await res.json();
      setSettings((prev) => ({ ...prev, ...result }));
      addToast(`${provider} saved`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [addToast]);

  const deleteLLM = useCallback(async (provider) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/llm/${provider}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Failed to remove LLM config');
      const result = await res.json();
      setSettings((prev) => ({ ...prev, ...result }));
      addToast(`${provider} removed`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [addToast]);

  const testLLM = useCallback(async (provider) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/llm/${provider}/test`, {
        method: 'POST',
        headers: getHeaders(),
      });
      const data = await res.json();
      return { success: data.success, message: data.message || (data.success ? 'OK' : 'Failed') };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }, []);

  const updateConnector = useCallback(async (id, data) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/connectors/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to save connector');
      const result = await res.json();
      setSettings((prev) => ({ ...prev, ...result }));
      addToast(`${id} connector saved`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [addToast]);

  const updateEditor = useCallback(async (prefs) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/editor`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error('Failed to save editor prefs');
      const result = await res.json();
      setSettings((prev) => ({ ...prev, ...result }));
      addToast('Editor prefs saved', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [addToast]);

  const exportSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/export`, { headers: getHeaders() });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'piratedev-settings.json';
      a.click();
      URL.revokeObjectURL(url);
      addToast('Settings exported', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [addToast]);

  return {
    settings,
    loading,
    error,
    toasts,
    addToast,
    dismissToast,
    updateLLM,
    deleteLLM,
    testLLM,
    updateConnector,
    updateEditor,
    exportSettings,
    refetch: fetchSettings,
  };
}
