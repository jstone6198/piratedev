import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { API_BASE } from '../api';
import {
  FaChevronDown,
  FaChevronRight,
  FaFileAlt,
  FaFolder,
  FaFolderOpen,
  FaHtml5,
  FaCss3Alt,
  FaJs,
  FaMarkdown,
  FaPython,
  FaReact,
} from 'react-icons/fa';
import { VscFile, VscJson, VscSymbolMisc } from 'react-icons/vsc';

const FILE_ICONS = {
  js: { icon: FaJs, color: '#f7df1e' },
  jsx: { icon: FaReact, color: '#61dafb' },
  ts: { icon: VscFile, color: '#3178c6' },
  tsx: { icon: FaReact, color: '#61dafb' },
  py: { icon: FaPython, color: '#3776ab' },
  html: { icon: FaHtml5, color: '#e34f26' },
  css: { icon: FaCss3Alt, color: '#1572b6' },
  json: { icon: VscJson, color: '#f7df1e' },
  md: { icon: FaMarkdown, color: '#ffffff' },
  txt: { icon: FaFileAlt, color: '#9e9e9e' },
};

const EXT_TO_LANGUAGE = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  md: 'markdown',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  txt: 'plaintext',
  env: 'plaintext',
  gitignore: 'plaintext',
  dockerfile: 'dockerfile',
};

function getLanguage(filename) {
  if (!filename) return 'plaintext';
  const ext = filename.split('.').pop().toLowerCase();
  return EXT_TO_LANGUAGE[ext] || 'plaintext';
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const config = FILE_ICONS[ext];
  if (config) {
    const Icon = config.icon;
    return <Icon style={{ color: config.color }} />;
  }
  return <VscFile style={{ color: '#9e9e9e' }} />;
}

function collectFilePaths(nodes, files = []) {
  for (const node of nodes) {
    if (node.type === 'file') {
      files.push(node.path);
      continue;
    }
    if (node.children?.length) {
      collectFilePaths(node.children, files);
    }
  }
  return files;
}

function collectDirectoryPaths(nodes, directories = []) {
  for (const node of nodes) {
    if (node.type !== 'directory') continue;
    directories.push(node.path);
    if (node.children?.length) {
      collectDirectoryPaths(node.children, directories);
    }
  }
  return directories;
}

function buildHeaders() {
  const ideKey = window.IDE_KEY || '';
  return ideKey ? { 'x-ide-key': ideKey } : {};
}

function SharedTreeNode({ node, depth, activeFile, expandedPaths, onToggleFolder, onSelectFile }) {
  const isDirectory = node.type === 'directory';
  const isExpanded = expandedPaths.has(node.path);
  const isActive = activeFile === node.path;

  return (
    <>
      <button
        type="button"
        className={`shared-tree-node ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: depth * 16 + 12 }}
        onClick={() => {
          if (isDirectory) {
            onToggleFolder(node.path);
            return;
          }
          onSelectFile(node.path);
        }}
        title={node.path}
      >
        <span className="shared-tree-chevron">
          {isDirectory ? (isExpanded ? <FaChevronDown /> : <FaChevronRight />) : null}
        </span>
        <span className="shared-tree-icon">
          {isDirectory
            ? (isExpanded ? <FaFolderOpen style={{ color: '#dcb67a' }} /> : <FaFolder style={{ color: '#dcb67a' }} />)
            : getFileIcon(node.name)}
        </span>
        <span className="shared-tree-label">{node.name}</span>
      </button>
      {isDirectory && isExpanded && node.children?.length ? (
        <div>
          {node.children.map((child) => (
            <SharedTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              expandedPaths={expandedPaths}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

export default function SharedView({ token }) {
  const [projectData, setProjectData] = useState(null);
  const [activeFile, setActiveFile] = useState('');
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [fileContents, setFileContents] = useState({});
  const [loadingProject, setLoadingProject] = useState(true);
  const [loadingFile, setLoadingFile] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadProject = async () => {
      setLoadingProject(true);
      setError('');
      setProjectData(null);
      setFileContents({});
      setActiveFile('');

      try {
        const response = await fetch(
          `${API_BASE}/api/projects/shared/${encodeURIComponent(token)}`,
          { headers: buildHeaders() }
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Failed to load shared project');
        }
        if (cancelled) return;

        const fileTree = Array.isArray(data.fileTree) ? data.fileTree : [];
        setProjectData(data);
        setExpandedPaths(new Set(collectDirectoryPaths(fileTree)));
        setActiveFile((current) => current || collectFilePaths(fileTree)[0] || '');
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load shared project');
        }
      } finally {
        if (!cancelled) {
          setLoadingProject(false);
        }
      }
    };

    loadProject();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!activeFile || fileContents[activeFile] !== undefined) {
      return;
    }

    let cancelled = false;

    const loadFile = async () => {
      setLoadingFile(activeFile);

      try {
        const url = new URL(
          `${API_BASE}/api/projects/shared/${encodeURIComponent(token)}/file`,
          window.location.origin
        );
        url.searchParams.set('path', activeFile);

        const response = await fetch(url, { headers: buildHeaders() });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Failed to load file');
        }
        if (cancelled) return;

        setFileContents((current) => ({ ...current, [activeFile]: data.content || '' }));
      } catch (loadError) {
        if (!cancelled) {
          setFileContents((current) => ({
            ...current,
            [activeFile]: `// ${loadError.message || 'Failed to load file'}`,
          }));
        }
      } finally {
        if (!cancelled) {
          setLoadingFile('');
        }
      }
    };

    loadFile();
    return () => {
      cancelled = true;
    };
  }, [activeFile, fileContents, token]);

  const fileTree = projectData?.fileTree || [];
  const activeContent = activeFile ? fileContents[activeFile] : '';
  const editorValue = useMemo(() => {
    if (!activeFile) {
      return '// No files available in this shared project.';
    }
    if (loadingFile === activeFile && fileContents[activeFile] === undefined) {
      return '// Loading file...';
    }
    return activeContent ?? '';
  }, [activeContent, activeFile, fileContents, loadingFile]);

  const handleToggleFolder = useCallback((folderPath) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  if (loadingProject) {
    return (
      <div className="shared-view-root">
        <div className="shared-view-empty">Loading shared project...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shared-view-root">
        <div className="shared-view-empty shared-view-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="shared-view-root">
      <header className="shared-view-toolbar">
        <div className="shared-view-toolbar-left">
          <VscSymbolMisc className="toolbar-logo" />
          <div className="shared-view-title-block">
            <div className="shared-view-title">{projectData?.project?.name || 'Shared Project'}</div>
            <div className="shared-view-subtitle">Shared by {projectData?.owner || 'Unknown'} - Read Only</div>
          </div>
        </div>
      </header>

      <div className="shared-view-banner">
        Shared by {projectData?.owner || 'Unknown'} - Read Only
      </div>

      <div className="shared-view-layout">
        <aside className="shared-view-sidebar">
          <div className="shared-view-sidebar-header">Explorer</div>
          <div className="shared-view-tree">
            {fileTree.length ? fileTree.map((node) => (
              <SharedTreeNode
                key={node.path}
                node={node}
                depth={0}
                activeFile={activeFile}
                expandedPaths={expandedPaths}
                onToggleFolder={handleToggleFolder}
                onSelectFile={setActiveFile}
              />
            )) : (
              <div className="shared-view-tree-empty">No files available.</div>
            )}
          </div>
        </aside>

        <section className="shared-view-editor-panel">
          <div className="shared-view-editor-header">
            <span>{activeFile || 'No file selected'}</span>
            <span className="shared-view-readonly-pill">Read Only</span>
          </div>
          <div className="shared-view-editor-shell">
            <Editor
              height="100%"
              theme="vs-dark"
              path={activeFile || 'shared-readonly.txt'}
              language={getLanguage(activeFile)}
              value={editorValue}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: 'JetBrains Mono, Fira Code, monospace',
                scrollBeyondLastLine: false,
                renderWhitespace: 'selection',
                wordWrap: 'off',
                padding: { top: 16 },
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
