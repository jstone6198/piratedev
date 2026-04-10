import React, { useState, useEffect, useRef } from 'react';

const COMMANDS = [
  { id: 'open-file', label: 'Open File', shortcut: 'Ctrl+P' },
  { id: 'save', label: 'Save', shortcut: 'Ctrl+S' },
  { id: 'run', label: 'Run', shortcut: 'Ctrl+Enter' },
  { id: 'git-commit', label: 'Git Commit', shortcut: '' },
  { id: 'toggle-terminal', label: 'Toggle Terminal', shortcut: 'Ctrl+`' },
  { id: 'toggle-preview', label: 'Toggle Preview', shortcut: '' },
  { id: 'switch-ai', label: 'Switch AI Engine', shortcut: '' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', shortcut: 'Ctrl+B' },
  { id: 'search-files', label: 'Search in Files', shortcut: 'Ctrl+Shift+F' },
  { id: 'new-project', label: 'New Project', shortcut: '' },
  { id: 'open-vps-browser', label: 'Open VPS Browser', shortcut: '' },
];

export default function CommandPalette({ visible, onClose, onExecute }) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setFilter('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  const filtered = filter
    ? COMMANDS.filter((c) =>
        c.label.toLowerCase().includes(filter.toLowerCase())
      )
    : COMMANDS;

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      onExecute(filtered[selectedIndex].id);
      onClose();
    }
  };

  if (!visible) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          style={styles.input}
        />
        <div style={styles.list}>
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              style={{
                ...styles.item,
                ...(i === selectedIndex ? styles.itemActive : {}),
              }}
              onClick={() => {
                onExecute(cmd.id);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span style={styles.label}>{cmd.label}</span>
              {cmd.shortcut && (
                <span style={styles.shortcut}>{cmd.shortcut}</span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={styles.empty}>No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: 80,
    zIndex: 9999,
  },
  modal: {
    width: 500,
    maxWidth: '90vw',
    background: '#252526',
    borderRadius: 8,
    border: '1px solid #444',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    background: '#1e1e1e',
    border: 'none',
    borderBottom: '1px solid #444',
    color: '#cccccc',
    fontSize: 14,
    fontFamily: "'JetBrains Mono', monospace",
    outline: 'none',
    boxSizing: 'border-box',
  },
  list: {
    maxHeight: 350,
    overflowY: 'auto',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    cursor: 'pointer',
    color: '#cccccc',
    fontSize: 13,
  },
  itemActive: {
    background: '#007acc',
    color: '#ffffff',
  },
  label: {},
  shortcut: {
    fontSize: 11,
    color: '#888',
    fontFamily: "'JetBrains Mono', monospace",
  },
  empty: {
    padding: '20px 16px',
    textAlign: 'center',
    color: '#666',
    fontSize: 13,
  },
};
