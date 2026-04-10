import React, { useState, useCallback, useRef, useEffect } from 'react';
import api from '../api';
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

function joinExplorerPath(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

function getParentDir(path) {
  if (!path) return '';
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function readFileEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];

    const readNextBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readNextBatch();
        },
        reject
      );
    };

    readNextBatch();
  });
}

async function collectEntryFiles(entry, parentPath = '') {
  if (entry.isFile) {
    const file = await readFileEntry(entry);
    return [{
      file,
      relativePath: joinExplorerPath(parentPath, file.name),
    }];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const nextParent = joinExplorerPath(parentPath, entry.name);
  const entries = await readDirectoryEntries(entry.createReader());
  const nestedFiles = await Promise.all(entries.map((child) => collectEntryFiles(child, nextParent)));
  return nestedFiles.flat();
}

function FileTreeNode({
  node,
  depth,
  activeFile,
  onOpenFile,
  expandedFolders,
  toggleFolder,
  onContextMenu,
  onSelectDirectory,
}) {
  const isFolder = node.type === 'folder';
  const isExpanded = expandedFolders.has(node.path);
  const isActive = activeFile === node.path;

  const handleClick = () => {
    if (isFolder) {
      onSelectDirectory(node.path);
      toggleFolder(node.path);
    } else {
      onSelectDirectory(getParentDir(node.path));
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
              onSelectDirectory={onSelectDirectory}
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
  revealRequest,
}) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [currentDirectory, setCurrentDirectory] = useState('');
  const dragCounter = useRef(0);
  const fileInputRef = useRef(null);

  const toggleFolder = useCallback((path) => {
    setCurrentDirectory(path || '');
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
    setCurrentDirectory(getParentPath(node));
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleRootContextMenu = (e) => {
    e.preventDefault();
    setCurrentDirectory('');
    setContextMenu({ x: e.clientX, y: e.clientY, node: null });
  };

  // Determine parent folder path for creating new items
  const getParentPath = (node) => {
    if (!node) return '';
    if (node.type === 'folder') return node.path;
    return getParentDir(node.path);
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

  const uploadFiles = useCallback(async (entries, targetPath = '') => {
    if (!project || entries.length === 0) return;

    const groupedUploads = new Map();
    for (const entry of entries) {
      const relativeDir = getParentDir(entry.relativePath || '');
      const destination = joinExplorerPath(targetPath, relativeDir);
      if (!groupedUploads.has(destination)) {
        groupedUploads.set(destination, []);
      }
      groupedUploads.get(destination).push(entry.file);
    }

    try {
      for (const [destination, files] of groupedUploads.entries()) {
        const formData = new FormData();
        for (const file of files) {
          formData.append('files', file);
        }

        const pathParam = destination ? `?path=${encodeURIComponent(destination)}` : '';
        await api.post(`/files/${encodeURIComponent(project)}/upload${pathParam}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      await refreshTree();
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.error || err.message));
    }
  }, [project, refreshTree]);

  const collectDroppedFiles = useCallback(async (dataTransfer) => {
    const items = Array.from(dataTransfer?.items || []);
    const entryFiles = [];

    for (const item of items) {
      if (item.kind !== 'file') continue;

      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry) {
        entryFiles.push(...await collectEntryFiles(entry));
      }
    }

    if (entryFiles.length > 0) {
      return entryFiles;
    }

    return Array.from(dataTransfer?.files || []).map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
      setIsDragging(true);
    }
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

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const droppedFiles = await collectDroppedFiles(e.dataTransfer);
    if (droppedFiles.length > 0) {
      await uploadFiles(droppedFiles, currentDirectory);
    }
  }, [collectDroppedFiles, currentDirectory, uploadFiles]);

  const handleFileInputChange = useCallback((e) => {
    if (e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files).map((file) => ({
        file,
        relativePath: file.webkitRelativePath || file.name,
      }));
      uploadFiles(selectedFiles, currentDirectory);
      e.target.value = '';
    }
  }, [currentDirectory, uploadFiles]);

  useEffect(() => {
    const targetPath = revealRequest?.path;
    if (!targetPath) return;

    const parts = targetPath.split('/').filter(Boolean);
    const foldersToExpand = [];
    for (let i = 0; i < parts.length; i += 1) {
      foldersToExpand.push(parts.slice(0, i + 1).join('/'));
    }

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      foldersToExpand.forEach((path) => next.add(path));
      return next;
    });
    setCurrentDirectory(getParentDir(targetPath));

    requestAnimationFrame(() => {
      const nodes = document.querySelectorAll('.file-tree [data-path]');
      const match = Array.from(nodes).find(
        (node) => node.getAttribute('data-path') === targetPath
      );
      match?.scrollIntoView({ block: 'nearest' });
    });
  }, [revealRequest]);

  useEffect(() => {
    setCurrentDirectory(getParentDir(activeFile));
  }, [activeFile]);

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
      style={{
        position: 'relative',
        border: isDragging ? '1px dashed rgba(99, 179, 237, 0.5)' : undefined,
        boxShadow: isDragging ? 'inset 0 0 0 1px rgba(99, 179, 237, 0.18)' : undefined,
      }}
    >
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
          <button className="icon-btn" title="New File" onClick={() => handleNewFile(currentDirectory)}>
            <VscNewFile />
          </button>
          <button className="icon-btn" title="New Folder" onClick={() => handleNewFolder(currentDirectory)}>
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
              onSelectDirectory={setCurrentDirectory}
            />
          ))
        )}
      </div>

      {isDragging && (
        <div
          className="file-drop-indicator"
          style={{
            position: 'absolute',
            inset: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            border: '2px dashed rgba(99, 179, 237, 0.85)',
            borderRadius: 10,
            background: 'rgba(15, 23, 42, 0.82)',
            color: '#dbeafe',
            pointerEvents: 'none',
            zIndex: 4,
            textAlign: 'center',
            boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.35)',
          }}
        >
          <FaUpload style={{ fontSize: 24 }} />
          <span style={{ fontWeight: 600 }}>Drop files here</span>
          <span style={{ fontSize: 12, color: '#93c5fd' }}>
            Uploading to {currentDirectory || 'project root'}
          </span>
        </div>
      )}

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
