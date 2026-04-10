import React, { useState, useCallback, useRef, useEffect } from 'react';
import api, { API_BASE } from '../api';
import {
  FaFolder,
  FaFolderOpen,
  FaJs,
  FaPython,
  FaHtml5,
  FaCss3Alt,
  FaReact,
  FaFileAlt,
  FaMarkdown,
  FaFileCode,
  FaChevronRight,
  FaChevronDown,
  FaUpload,
} from 'react-icons/fa';
import {
  VscJson,
  VscFile,
  VscNewFile,
  VscNewFolder,
  VscRefresh,
} from 'react-icons/vsc';

const FILE_ICONS = {
  js: { icon: FaJs, color: '#f7df1e' },
  jsx: { icon: FaReact, color: '#61dafb' },
  ts: { icon: FaFileCode, color: '#3178c6' },
  tsx: { icon: FaReact, color: '#61dafb' },
  py: { icon: FaPython, color: '#3776ab' },
  html: { icon: FaHtml5, color: '#e34f26' },
  css: { icon: FaCss3Alt, color: '#1572b6' },
  json: { icon: VscJson, color: '#f7df1e' },
  md: { icon: FaMarkdown, color: '#ffffff' },
  txt: { icon: FaFileAlt, color: '#9e9e9e' },
};

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const config = FILE_ICONS[ext];
  if (config) {
    const Icon = config.icon;
    return <Icon style={{ color: config.color }} />;
  }
  return <VscFile style={{ color: '#9e9e9e' }} />;
}

function FileTreeNode({
  node,
  depth,
  activeFile,
  onOpenFile,
  expandedFolders,
  toggleFolder,
  onContextMenu,
}) {
  const isFolder = node.type === 'folder';
  const isExpanded = expandedFolders.has(node.path);
  const isActive = activeFile === node.path;

  const handleClick = () => {
    if (isFolder) {
      toggleFolder(node.path);
    } else {
      onOpenFile(node);
    }
  };

  return (
    <>
      <div
        className={`tree-node ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        data-path={node.path}
        title={node.path}
      >
        {isFolder ? (
          <span className="tree-chevron">
            {isExpanded ? <FaChevronDown /> : <FaChevronRight />}
          </span>
        ) : (
          <span className="tree-chevron spacer" />
        )}
        <span className="tree-icon">
          {isFolder ? (
            isExpanded ? (
              <FaFolderOpen style={{ color: '#dcb67a' }} />
            ) : (
              <FaFolder style={{ color: '#dcb67a' }} />
            )
          ) : (
            getFileIcon(node.name)
          )}
        </span>
        <span className="tree-label">{node.name}</span>
      </div>
      {isFolder && isExpanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onOpenFile={onOpenFile}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function FileExplorer({
  project,
  fileTree,
  setFileTree,
  activeFile,
  onOpenFile,
}) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef(null);

  const toggleFolder = useCallback((path) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const refreshTree = useCallback(async () => {
    if (!project) return;
    try {
      const res = await api.get(`/files/${encodeURIComponent(project)}`);
      setFileTree(res.data || []);
    } catch (err) {
      console.error('Failed to refresh tree:', err);
    }
  }, [project, setFileTree]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleContextMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleRootContextMenu = (e) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node: null });
  };

  // Determine parent folder path for creating new items
  const getParentPath = (node) => {
    if (!node) return '';
    if (node.type === 'folder') return node.path;
    const parts = node.path.split('/');
    parts.pop();
    return parts.join('/');
  };

  const handleNewFile = async (parentPath) => {
    const name = prompt('File name:');
    if (!name || !name.trim()) return;
    try {
      await api.post(`/files/${encodeURIComponent(project)}`, {
        name: name.trim(),
        type: 'file',
        path: parentPath || '',
      });
      await refreshTree();
    } catch (err) {
      alert('Failed to create file: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleNewFolder = async (parentPath) => {
    const name = prompt('Folder name:');
    if (!name || !name.trim()) return;
    try {
      await api.post(`/files/${encodeURIComponent(project)}`, {
        name: name.trim(),
        type: 'folder',
        path: parentPath || '',
      });
      await refreshTree();
    } catch (err) {
      alert('Failed to create folder: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRename = async (nodePath) => {
    if (!nodePath) return;
    const parts = nodePath.split('/');
    const oldName = parts.pop();
    const parentDir = parts.join('/');

    const newName = prompt('New name:', oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;

    const newPath = parentDir ? `${parentDir}/${newName.trim()}` : newName.trim();
    try {
      await api.post(`/files/${encodeURIComponent(project)}/rename`, {
        oldPath: nodePath,
        newPath,
      });
      await refreshTree();
    } catch (err) {
      alert('Failed to rename: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDelete = async (nodePath) => {
    if (!nodePath) return;
    if (!confirm(`Delete "${nodePath}"?`)) return;
    try {
      await api.delete(`/files/${encodeURIComponent(project)}`, {
        data: { path: nodePath },
      });
      await refreshTree();
    } catch (err) {
      alert('Failed to delete: ' + (err.response?.data?.error || err.message));
    }
  };

  const uploadFiles = useCallback(async (files, targetPath = '') => {
    if (!project || files.length === 0) return;
    const formData = new FormData();
    for (const f of files) formData.append('files', f);
    try {
      const pathParam = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
      await api.post(`/files/${encodeURIComponent(project)}/upload${pathParam}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await refreshTree();
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.error || err.message));
    }
  }, [project, refreshTree]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(Array.from(e.dataTransfer.files));
    }
  }, [uploadFiles]);

  const handleFileInputChange = useCallback((e) => {
    if (e.target.files.length > 0) {
      uploadFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  }, [uploadFiles]);

  if (!project) {
    return (
      <div className="file-explorer">
        <div className="file-explorer-empty">Select a project to browse files</div>
      </div>
    );
  }

  return (
    <div
      className="file-explorer"
      onContextMenu={handleRootContextMenu}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="file-drop-overlay">
          <FaUpload style={{ fontSize: 32, marginBottom: 8 }} />
          <span>Drop files to upload</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <div className="file-explorer-header">
        <span className="file-explorer-title">EXPLORER</span>
        <div className="file-explorer-actions">
          <button className="icon-btn" title="Upload Files" onClick={() => fileInputRef.current?.click()}>
            <FaUpload />
          </button>
          <button className="icon-btn" title="New File" onClick={() => handleNewFile('')}>
            <VscNewFile />
          </button>
          <button className="icon-btn" title="New Folder" onClick={() => handleNewFolder('')}>
            <VscNewFolder />
          </button>
          <button className="icon-btn" title="Refresh" onClick={refreshTree}>
            <VscRefresh />
          </button>
        </div>
      </div>
      <div className="file-tree" data-testid="file-tree">
        {fileTree.length === 0 ? (
          <div className="file-explorer-empty">No files yet</div>
        ) : (
          fileTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeFile}
              onOpenFile={onOpenFile}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              handleNewFile(getParentPath(contextMenu.node));
              setContextMenu(null);
            }}
          >
            New File
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              handleNewFolder(getParentPath(contextMenu.node));
              setContextMenu(null);
            }}
          >
            New Folder
          </div>
          {contextMenu.node && (
            <>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item"
                onClick={() => {
                  handleRename(contextMenu.node.path);
                  setContextMenu(null);
                }}
              >
                Rename
              </div>
              <div
                className="context-menu-item danger"
                onClick={() => {
                  handleDelete(contextMenu.node.path);
                  setContextMenu(null);
                }}
              >
                Delete
              </div>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item"
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.node.path).catch(() => {});
                  setContextMenu(null);
                }}
              >
                Copy Path
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
