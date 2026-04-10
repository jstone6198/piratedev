import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { FaFolder, FaFile, FaArrowLeft, FaTimes, FaHome } from 'react-icons/fa';

export default function VPSBrowser({ visible, onClose, onOpenFile }) {
  const [currentPath, setCurrentPath] = useState('/home/claude-runner/');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fileContent, setFileContent] = useState(null);
  const [viewingFile, setViewingFile] = useState(null);

  const browse = useCallback(async (p) => {
    setLoading(true);
    setFileContent(null);
    setViewingFile(null);
    try {
      const res = await api.get('/vps/browse', { params: { path: p } });
      setEntries(res.data.entries || []);
      setCurrentPath(res.data.path || p);
    } catch (err) {
      console.error('VPS browse error:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) browse(currentPath);
  }, [visible]);

  const handleClick = async (entry) => {
    const full = currentPath.endsWith('/') ? currentPath + entry.name : currentPath + '/' + entry.name;
    if (entry.type === 'dir') {
      browse(full);
    } else {
      setLoading(true);
      try {
        const res = await api.get('/vps/read', { params: { path: full } });
        setFileContent(res.data.content);
        setViewingFile(full);
      } catch (err) {
        alert('Cannot read file: ' + (err.response?.data?.error || err.message));
      } finally {
        setLoading(false);
      }
    }
  };

  const goUp = () => {
    if (currentPath === '/home/claude-runner/' || currentPath === '/home/claude-runner') return;
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/home/claude-runner';
    browse(parent.startsWith('/home/claude-runner') ? parent : '/home/claude-runner/');
  };

  if (!visible) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="vps-browser-modal" onClick={e => e.stopPropagation()}>
        <div className="vps-header">
          <div className="vps-nav">
            <button className="vps-nav-btn" onClick={goUp} title="Go up"><FaArrowLeft /></button>
            <button className="vps-nav-btn" onClick={() => browse('/home/claude-runner/')} title="Home"><FaHome /></button>
            <span className="vps-path">{currentPath}</span>
          </div>
          <button className="vps-close-btn" onClick={onClose}><FaTimes /></button>
        </div>

        {viewingFile ? (
          <div className="vps-file-view">
            <div className="vps-file-header">
              <span>{viewingFile.split('/').pop()}</span>
              <button className="vps-nav-btn" onClick={() => { setFileContent(null); setViewingFile(null); }}>Back</button>
            </div>
            <pre className="vps-file-content">{fileContent}</pre>
          </div>
        ) : (
          <div className="vps-entries">
            {loading && <div className="vps-loading">Loading...</div>}
            {!loading && entries.length === 0 && <div className="vps-empty">Empty directory</div>}
            {!loading && entries.map(e => (
              <div key={e.name} className="vps-entry" onClick={() => handleClick(e)}>
                {e.type === 'dir' ? <FaFolder className="vps-icon vps-icon-dir" /> : <FaFile className="vps-icon vps-icon-file" />}
                <span className="vps-entry-name">{e.name}</span>
                {e.type === 'file' && <span className="vps-entry-size">{formatSize(e.size)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
