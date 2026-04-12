import React, { useState, useEffect } from 'react';
import api from '../api';

const DEFAULT_TEMPLATE = `# PIRATEDEV.md - Project AI Instructions

## About This Project
Describe what this project does.

## Tech Stack
- Framework:
- Language:
- Database:

## Coding Guidelines
- Prefer functional components
- Use async/await over .then()

## Important Files
- Entry point: src/index.js
- Main component: src/App.jsx
`;

export default function ContextIndicator({ project, active, onToggle, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!editing || !project) return;
    setLoading(true);
    api.get(`/context/${encodeURIComponent(project)}`)
      .then(({ data }) => setContent(data.content || ''))
      .catch(() => setContent(''))
      .finally(() => setLoading(false));
  }, [editing, project]);

  const handleSave = async () => {
    if (!project) return;
    setLoading(true);
    try {
      await api.post(`/context/${encodeURIComponent(project)}/init`, { content });
      setEditing(false);
      onEdit?.();
    } catch (err) {
      console.error('Failed to save PIRATEDEV.md:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={onToggle}
        style={{
          ...styles.pill,
          background: active ? 'rgba(16, 185, 129, 0.18)' : 'rgba(100, 100, 100, 0.18)',
          borderColor: active ? 'rgba(16, 185, 129, 0.45)' : 'rgba(100, 100, 100, 0.45)',
          color: active ? '#d1fae5' : '#888',
        }}
        title={active ? 'Context ON - click to disable' : 'Context OFF - click to enable'}
      >
        <span style={{
          ...styles.dot,
          background: active ? '#10b981' : '#666',
        }} />
        Context
      </button>
      {active && (
        <button
          onClick={() => setEditing(true)}
          style={styles.editBtn}
          title="Edit PIRATEDEV.md"
        >
          ✏️
        </button>
      )}
      {editing && (
        <div style={styles.modalOverlay} onClick={() => setEditing(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>PIRATEDEV.md</span>
              <button style={styles.closeBtn} onClick={() => setEditing(false)}>✕</button>
            </div>
            <textarea
              style={styles.textarea}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Add project-specific AI instructions..."
              disabled={loading}
            />
            <div style={styles.modalActions}>
              <button
                style={styles.templateBtn}
                onClick={() => setContent(DEFAULT_TEMPLATE)}
              >
                Default Template
              </button>
              <button
                style={styles.saveBtn}
                onClick={handleSave}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '999px',
    border: '1px solid',
    fontSize: '10px',
    fontWeight: 700,
    cursor: 'pointer',
    background: 'none',
    letterSpacing: '0.3px',
    lineHeight: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    display: 'inline-block',
  },
  editBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '0 2px',
    lineHeight: 1,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3000,
  },
  modal: {
    width: 'min(600px, 90vw)',
    maxHeight: '70vh',
    background: '#1e1e1e',
    border: '1px solid #333',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #333',
  },
  modalTitle: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: 700,
  },
  closeBtn: {
    background: 'none',
    border: '1px solid #444',
    color: '#aaa',
    borderRadius: 4,
    cursor: 'pointer',
    width: 28,
    height: 28,
  },
  textarea: {
    flex: 1,
    minHeight: 300,
    margin: '12px 16px',
    padding: 12,
    background: '#2d2d2d',
    border: '1px solid #444',
    borderRadius: 6,
    color: '#eee',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    resize: 'vertical',
    outline: 'none',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0 16px 12px',
    gap: 8,
  },
  templateBtn: {
    background: '#333',
    color: '#ccc',
    border: '1px solid #555',
    borderRadius: 4,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer',
  },
  saveBtn: {
    background: '#007acc',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '6px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
