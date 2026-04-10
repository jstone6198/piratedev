import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaCheck, FaImage, FaSpinner, FaTimes } from 'react-icons/fa';
import api from '../api';

const SIZE_OPTIONS = [
  { label: '1024 x 1024', width: 1024, height: 1024 },
  { label: '1792 x 1024', width: 1792, height: 1024 },
  { label: '1024 x 1792', width: 1024, height: 1792 },
];

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const activeObjectUrlsRef = useRef(new Set());

  useEffect(() => {
    setHistory([]);
    setPrompt('');
    setFilename('');
    setSelectedSize(SIZE_OPTIONS[0]);
    setError('');
  }, [project]);

  useEffect(() => () => {
    for (const objectUrl of activeObjectUrlsRef.current) {
      URL.revokeObjectURL(objectUrl);
    }
    activeObjectUrlsRef.current.clear();
  }, []);

  const latestImage = history[0] || null;
  const canGenerate = Boolean(project && prompt.trim()) && !loading;
  const sessionCountLabel = useMemo(() => {
    if (history.length === 1) return '1 image this session';
    return `${history.length} images this session`;
  }, [history.length]);

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
          <span className="imagegen-label">Size</span>
          <select
            className="imagegen-select"
            value={`${selectedSize.width}x${selectedSize.height}`}
            onChange={(event) => {
              const next = SIZE_OPTIONS.find((option) => `${option.width}x${option.height}` === event.target.value);
              if (next) setSelectedSize(next);
            }}
          >
            {SIZE_OPTIONS.map((option) => (
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
