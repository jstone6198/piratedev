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
  VscClose,
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

function isDirectoryNode(node) {
  return node?.type === 'folder' || node?.type === 'directory';
}

function getNodeName(node) {
  return node?.name || node?.path?.split('/').filter(Boolean).pop() || '';
}

function findNodeByPath(nodes, targetPath) {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children?.length) {
      const match = findNodeByPath(node.children, targetPath);
      if (match) return match;
    }
  }
  return null;
}

function collectDirectoryPaths(nodes, directories = ['']) {
  for (const node of nodes) {
    if (!isDirectoryNode(node)) continue;
    directories.push(node.path);
    if (node.children?.length) {
      collectDirectoryPaths(node.children, directories);
    }
  }
  return directories;
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
  selectedPath,
  onOpenFile,
  expandedFolders,
  toggleFolder,
  onContextMenu,
  onSelectDirectory,
  onSelectNode,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}) {
  const isFolder = isDirectoryNode(node);
  const isExpanded = expandedFolders.has(node.path);
  const isActive = activeFile === node.path;
  const isSelected = selectedPath === node.path;
  const isRenaming = renamingPath === node.path;

  const handleClick = () => {
    onSelectNode(node.path);
    if (isFolder) {
      onSelectDirectory(node.path);
      toggleFolder(node.path);
      return;
    }
    onSelectDirectory(getParentDir(node.path));
    onOpenFile(node);
  };

  return (
    <>
      <div
        className={`tree-node ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
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
        {isRenaming ? (
          <input
            className="tree-rename-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => onRenameSubmit(node)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                onRenameSubmit(node);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onRenameCancel();
              }
            }}
            autoFocus
          />
        ) : (
          <span className="tree-label">{node.name}</span>
        )}
      </div>
      {isFolder && isExpanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              onContextMenu={onContextMenu}
              onSelectDirectory={onSelectDirectory}
              onSelectNode={onSelectNode}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
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
  const [selectedPath, setSelectedPath] = useState('');
  const [renamingPath, setRenamingPath] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [moveDialog, setMoveDialog] = useState(null);
  const dragCounter = useRef(0);
  const fileInputRef = useRef(null);
  const skipRenameSubmitRef = useRef(false);
  const renameSubmittingRef = useRef(false);

  const getParentPath = useCallback((node) => {
    if (!node) return '';
    if (isDirectoryNode(node)) return node.path;
    return getParentDir(node.path);
  }, []);

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

  const performRename = useCallback(async (oldPath, newPath, node) => {
    await api.post(`/files/${encodeURIComponent(project)}/rename`, {
      oldPath,
      newPath,
    });
    await refreshTree();
    setSelectedPath(newPath);
    if (node && !isDirectoryNode(node)) {
      onOpenFile({
        ...node,
        path: newPath,
        name: newPath.split('/').filter(Boolean).pop() || node.name,
      });
    }
  }, [onOpenFile, project, refreshTree]);

  const beginRename = useCallback((node) => {
    if (!node?.path) return;
    skipRenameSubmitRef.current = false;
    setSelectedPath(node.path);
    setRenamingPath(node.path);
    setRenameValue(getNodeName(node));
  }, []);

  const cancelRename = useCallback(() => {
    skipRenameSubmitRef.current = true;
    setRenamingPath('');
    setRenameValue('');
  }, []);

  const submitRename = useCallback(async (node) => {
    if (renameSubmittingRef.current) return;
    if (skipRenameSubmitRef.current) {
      skipRenameSubmitRef.current = false;
      return;
    }
    if (!node?.path || renamingPath !== node.path) return;

    const trimmedName = renameValue.trim();
    const currentName = getNodeName(node);
    if (!trimmedName || trimmedName === currentName) {
      cancelRename();
      return;
    }

    const newPath = joinExplorerPath(getParentDir(node.path), trimmedName);
    try {
      renameSubmittingRef.current = true;
      await performRename(node.path, newPath, node);
      cancelRename();
    } catch (err) {
      alert('Failed to rename: ' + (err.response?.data?.error || err.message));
    } finally {
      renameSubmittingRef.current = false;
    }
  }, [cancelRename, performRename, renameValue, renamingPath]);

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

  const openMoveDialog = useCallback((node) => {
    if (!node?.path) return;
    setSelectedPath(node.path);
    setMoveDialog({
      node,
      destination: getParentDir(node.path),
    });
  }, []);

  const submitMove = useCallback(async () => {
    if (!moveDialog?.node) return;
    const newPath = joinExplorerPath(moveDialog.destination, getNodeName(moveDialog.node));
    try {
      await performRename(moveDialog.node.path, newPath, moveDialog.node);
      setMoveDialog(null);
    } catch (err) {
      alert('Failed to move: ' + (err.response?.data?.error || err.message));
    }
  }, [moveDialog, performRename]);

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
    dragCounter.current += 1;
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
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
    const handleClick = () => setContextMenu(null);
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && moveDialog) {
        setMoveDialog(null);
        return;
      }

      if (event.key !== 'F2' || !selectedPath || renamingPath || moveDialog) return;

      const target = event.target;
      const tagName = target?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable) return;

      const node = findNodeByPath(fileTree, selectedPath);
      if (!node) return;

      event.preventDefault();
      beginRename(node);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [beginRename, fileTree, moveDialog, renamingPath, selectedPath]);

  const handleContextMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPath(node.path);
    setCurrentDirectory(getParentPath(node));
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleRootContextMenu = (e) => {
    e.preventDefault();
    setCurrentDirectory('');
    setContextMenu({ x: e.clientX, y: e.clientY, node: null });
  };

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
      foldersToExpand.forEach((folderPath) => next.add(folderPath));
      return next;
    });
    setCurrentDirectory(getParentDir(targetPath));
    setSelectedPath(targetPath);

    requestAnimationFrame(() => {
      const nodes = document.querySelectorAll('.file-tree [data-path]');
      const match = Array.from(nodes).find((node) => node.getAttribute('data-path') === targetPath);
      match?.scrollIntoView({ block: 'nearest' });
    });
  }, [revealRequest]);

  useEffect(() => {
    setCurrentDirectory(getParentDir(activeFile));
    if (activeFile) {
      setSelectedPath(activeFile);
    }
  }, [activeFile]);

  useEffect(() => {
    if (project) return;
    setSelectedPath('');
    setRenamingPath('');
    setRenameValue('');
    setMoveDialog(null);
  }, [project]);

  const directoryOptions = collectDirectoryPaths(fileTree)
    .filter((dirPath, index, allDirs) => allDirs.indexOf(dirPath) === index)
    .filter((dirPath) => {
      if (!moveDialog?.node || !dirPath) return true;
      return dirPath !== moveDialog.node.path && !dirPath.startsWith(`${moveDialog.node.path}/`);
    });

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
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              onContextMenu={handleContextMenu}
              onSelectDirectory={setCurrentDirectory}
              onSelectNode={setSelectedPath}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRename}
              onRenameCancel={cancelRename}
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
                  beginRename(contextMenu.node);
                  setContextMenu(null);
                }}
              >
                Rename
              </div>
              <div
                className="context-menu-item"
                onClick={() => {
                  openMoveDialog(contextMenu.node);
                  setContextMenu(null);
                }}
              >
                Move to...
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

      {moveDialog && (
        <div className="modal-overlay" onClick={() => setMoveDialog(null)}>
          <div className="file-move-modal" onClick={(e) => e.stopPropagation()}>
            <div className="file-move-modal-header">
              <div>
                <div className="file-move-modal-title">Move to...</div>
                <div className="file-move-modal-subtitle">{moveDialog.node.path}</div>
              </div>
              <button
                type="button"
                className="file-move-close"
                onClick={() => setMoveDialog(null)}
                aria-label="Close move dialog"
              >
                <VscClose />
              </button>
            </div>
            <div className="file-move-list" role="listbox" aria-label="Destination folders">
              {directoryOptions.map((dirPath) => (
                <button
                  key={dirPath || '__root__'}
                  type="button"
                  className={`file-move-option ${moveDialog.destination === dirPath ? 'selected' : ''}`}
                  onClick={() => setMoveDialog((prev) => ({ ...prev, destination: dirPath }))}
                >
                  {dirPath || 'project root'}
                </button>
              ))}
            </div>
            <div className="file-move-actions">
              <button type="button" className="file-move-btn secondary" onClick={() => setMoveDialog(null)}>
                Cancel
              </button>
              <button type="button" className="file-move-btn primary" onClick={submitMove}>
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
