import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaCheck, FaImage, FaSpinner, FaTimes } from 'react-icons/fa';
import api from '../api';

const SIZE_OPTIONS = [
  { label: '1024 x 1024', width: 1024, height: 1024 },
  { label: '1792 x 1024', width: 1792, height: 1024 },
  { label: '1024 x 1792', width: 1024, height: 1792 },
];

const CUSTOM_PROVIDER_ID = 'custom';

function sizeToOption(size) {
  const [width, height] = String(size).split('x').map((part) => Number(part));
  if (!width || !height) return null;
  return { label: `${width} x ${height}`, width, height };
}

function makeAuthHeaders() {
  const headers = {};
  const ideKey = window.IDE_KEY || '';
  const authToken = localStorage.getItem('auth-token') || '';

  if (ideKey) {
    headers['x-ide-key'] = ideKey;
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  return headers;
}

async function fetchPreviewUrl(resourceUrl) {
  const response = await fetch(resourceUrl, {
    headers: makeAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Preview fetch failed with status ${response.status}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export default function ImageGenPanel({ project, visible, onClose, onImageAdded }) {
  const [prompt, setPrompt] = useState('');
  const [filename, setFilename] = useState('');
  const [selectedSize, setSelectedSize] = useState(SIZE_OPTIONS[0]);
  const [providers, setProviders] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState('grok');
  const [customApiKey, setCustomApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const activeObjectUrlsRef = useRef(new Set());

  useEffect(() => {
    setHistory([]);
    setPrompt('');
    setFilename('');
    setSelectedSize(SIZE_OPTIONS[0]);
    setSelectedProviderId('grok');
    setCustomApiKey('');
    setError('');
  }, [project]);

  useEffect(() => {
    if (!visible) return undefined;

    let cancelled = false;

    const loadProviders = async () => {
      try {
        const response = await api.get('/imagegen/providers');
        if (cancelled) return;

        const nextProviders = Array.isArray(response.data?.providers) ? response.data.providers : [];
        setProviders(nextProviders);

        const grokProvider = nextProviders.find((provider) => provider.id === 'grok' && provider.hasKey);
        const firstConfiguredProvider = nextProviders.find((provider) => provider.hasKey);
        setSelectedProviderId(grokProvider?.id || firstConfiguredProvider?.id || nextProviders[0]?.id || CUSTOM_PROVIDER_ID);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to load image providers');
        }
      }
    };

    loadProviders();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => () => {
    for (const objectUrl of activeObjectUrlsRef.current) {
      URL.revokeObjectURL(objectUrl);
    }
    activeObjectUrlsRef.current.clear();
  }, []);

  const latestImage = history[0] || null;
  const sortedProviders = useMemo(() => (
    [...providers].sort((a, b) => {
      if (a.hasKey === b.hasKey) return 0;
      return a.hasKey ? -1 : 1;
    })
  ), [providers]);
  const selectedProvider = useMemo(() => (
    providers.find((provider) => provider.id === selectedProviderId) || null
  ), [providers, selectedProviderId]);
  const sizeOptions = useMemo(() => {
    if (selectedProviderId === CUSTOM_PROVIDER_ID || !selectedProvider?.sizes?.length) {
      return SIZE_OPTIONS;
    }

    const providerSizes = selectedProvider.sizes
      .map(sizeToOption)
      .filter(Boolean);

    return providerSizes.length ? providerSizes : SIZE_OPTIONS;
  }, [selectedProvider, selectedProviderId]);
  const canGenerate = Boolean(project && prompt.trim()) && !loading;
  const sessionCountLabel = useMemo(() => {
    if (history.length === 1) return '1 image this session';
    return `${history.length} images this session`;
  }, [history.length]);

  useEffect(() => {
    const selectedSizeValue = `${selectedSize.width}x${selectedSize.height}`;
    const hasSelectedSize = sizeOptions.some((option) => `${option.width}x${option.height}` === selectedSizeValue);

    if (!hasSelectedSize) {
      setSelectedSize(sizeOptions[0] || SIZE_OPTIONS[0]);
    }
  }, [selectedSize, sizeOptions]);

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setLoading(true);
    setError('');

    try {
      const response = await api.post(`/imagegen/${encodeURIComponent(project)}/generate`, {
        prompt: prompt.trim(),
        width: selectedSize.width,
        height: selectedSize.height,
        filename: filename.trim() || undefined,
        provider: selectedProviderId,
        customApiKey: selectedProviderId === CUSTOM_PROVIDER_ID ? customApiKey.trim() || undefined : undefined,
      });

      const previewUrl = await fetchPreviewUrl(response.data.url);
      activeObjectUrlsRef.current.add(previewUrl);

      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt: prompt.trim(),
        width: selectedSize.width,
        height: selectedSize.height,
        path: response.data.path,
        url: response.data.url,
        previewUrl,
        added: false,
      };

      setHistory((current) => [entry, ...current]);
      setFilename('');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || 'Image generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToProject = async (entry) => {
    try {
      await onImageAdded?.(entry);
      setHistory((current) => current.map((item) => (
        item.id === entry.id
          ? { ...item, added: true }
          : item
      )));
    } catch (err) {
      setError(err.message || 'Failed to add image to project');
    }
  };

  if (!visible) return null;

  return (
    <div className="imagegen-sidebar">
      <div className="imagegen-header">
        <div className="imagegen-title-row">
          <FaImage />
          <div>
            <div className="imagegen-title">Image Generation</div>
            <div className="imagegen-subtitle">{project || 'Select a project to begin'}</div>
          </div>
        </div>
        <button className="imagegen-close-btn" onClick={onClose} aria-label="Close image generation panel">
          <FaTimes />
        </button>
      </div>

      <div className="imagegen-body">
        <label className="imagegen-field">
          <span className="imagegen-label">Prompt</span>
          <textarea
            className="imagegen-textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the image you want to generate"
            rows={5}
          />
        </label>

        <label className="imagegen-field">
          <span className="imagegen-label">Provider</span>
          <select
            className="imagegen-select"
            value={selectedProviderId}
            onChange={(event) => {
              setSelectedProviderId(event.target.value);
              setCustomApiKey('');
            }}
          >
            {sortedProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}{provider.hasKey ? ' ✓' : ''}
              </option>
            ))}
            <option value={CUSTOM_PROVIDER_ID}>Custom API Key</option>
          </select>
        </label>

        {selectedProviderId === CUSTOM_PROVIDER_ID && (
          <label className="imagegen-field">
            <span className="imagegen-label">Custom API Key</span>
            <input
              className="imagegen-input"
              type="password"
              value={customApiKey}
              onChange={(event) => setCustomApiKey(event.target.value)}
              placeholder="Paste your API key"
            />
          </label>
        )}

        <label className="imagegen-field">
          <span className="imagegen-label">Size</span>
          <select
            className="imagegen-select"
            value={`${selectedSize.width}x${selectedSize.height}`}
            onChange={(event) => {
              const next = sizeOptions.find((option) => `${option.width}x${option.height}` === event.target.value);
              if (next) setSelectedSize(next);
            }}
          >
            {sizeOptions.map((option) => (
              <option key={`${option.width}x${option.height}`} value={`${option.width}x${option.height}`}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="imagegen-field">
          <span className="imagegen-label">Filename</span>
          <input
            className="imagegen-input"
            type="text"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
            placeholder="Optional, auto-generated if blank"
          />
        </label>

        <button
          className="imagegen-generate-btn"
          onClick={handleGenerate}
          disabled={!canGenerate}
        >
          {loading ? <FaSpinner className="toolbar-spinner" /> : <FaImage />}
          <span>{loading ? 'Generating...' : 'Generate'}</span>
        </button>

        {error && <div className="imagegen-error">{error}</div>}

        {latestImage && (
          <div className="imagegen-preview-card">
            <div className="imagegen-section-title">Latest Preview</div>
            <img
              className="imagegen-preview-image"
              src={latestImage.previewUrl}
              alt={latestImage.prompt}
            />
            <div className="imagegen-preview-meta">
              <span>{latestImage.width} x {latestImage.height}</span>
              <span>{latestImage.path}</span>
            </div>
            <button
              className="imagegen-add-btn"
              onClick={() => handleAddToProject(latestImage)}
              disabled={latestImage.added}
            >
              {latestImage.added ? <FaCheck /> : <FaImage />}
              <span>{latestImage.added ? 'Added to Project' : 'Add to Project'}</span>
            </button>
          </div>
        )}

        <div className="imagegen-history">
          <div className="imagegen-history-header">
            <div className="imagegen-section-title">History</div>
            <div className="imagegen-history-count">{sessionCountLabel}</div>
          </div>
          {history.length === 0 ? (
            <div className="imagegen-empty">Generated images will appear here for this session.</div>
          ) : (
            history.map((entry) => (
              <div key={entry.id} className="imagegen-history-item">
                <img className="imagegen-history-thumb" src={entry.previewUrl} alt={entry.prompt} />
                <div className="imagegen-history-copy">
                  <div className="imagegen-history-path">{entry.path}</div>
                  <div className="imagegen-history-prompt">{entry.prompt}</div>
                  <div className="imagegen-history-size">{entry.width} x {entry.height}</div>
                </div>
                <button
                  className="imagegen-history-action"
                  onClick={() => handleAddToProject(entry)}
                  disabled={entry.added}
                >
                  {entry.added ? 'Added' : 'Add'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
