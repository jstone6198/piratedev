import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';

const GRID_SIZE = 8;
const HISTORY_LIMIT = 50;
const DEFAULT_FILE = 'components/GeneratedPage.jsx';

const PALETTE = [
  { group: 'Layout', items: ['Container', 'Row', 'Column', 'Grid', 'Spacer'] },
  { group: 'Content', items: ['Heading', 'Paragraph', 'Image', 'Icon', 'Link'] },
  { group: 'Input', items: ['Button', 'TextField', 'Checkbox', 'Select', 'Toggle'] },
  { group: 'Data', items: ['Table', 'Card', 'List', 'Badge', 'Avatar'] },
  { group: 'Navigation', items: ['Navbar', 'Sidebar', 'Tabs', 'Breadcrumb', 'Footer'] },
];

const VIEWPORTS = [
  { key: 'desktop', label: 'Desktop', width: 1280 },
  { key: 'tablet', label: 'Tablet', width: 768 },
  { key: 'mobile', label: 'Mobile', width: 375 },
];

const HANDLE_POSITIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function makeId(prefix = 'node') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function snap(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function parsePx(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultProps(type) {
  switch (type) {
    case 'Heading':
      return { content: 'Heading', fontSize: 32, fontWeight: '700', color: '#111827', textAlign: 'left' };
    case 'Paragraph':
      return { content: 'Write clear page copy here.', fontSize: 16, fontWeight: '400', color: '#374151', textAlign: 'left' };
    case 'Button':
      return { label: 'Button', variant: 'primary', size: 'medium', onClick: '' };
    case 'Container':
    case 'Card':
      return {
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        backgroundColor: type === 'Card' ? '#ffffff' : 'transparent',
        borderRadius: 8,
        border: type === 'Card' ? '1px solid #d1d5db' : '1px dashed #cbd5e1',
      };
    case 'Image':
    case 'Avatar':
      return { src: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=800', alt: 'Preview', objectFit: 'cover', width: 160, height: 120 };
    case 'Link':
      return { content: 'Link', color: '#2563eb', fontSize: 16, fontWeight: '500', textAlign: 'left' };
    default:
      return {};
  }
}

function defaultSize(type) {
  switch (type) {
    case 'Navbar':
    case 'Footer':
      return { w: 640, h: 72 };
    case 'Sidebar':
      return { w: 220, h: 420 };
    case 'Table':
      return { w: 520, h: 220 };
    case 'Image':
      return { w: 240, h: 160 };
    case 'TextField':
    case 'Select':
      return { w: 240, h: 44 };
    case 'Button':
      return { w: 128, h: 44 };
    case 'Spacer':
      return { w: 160, h: 32 };
    case 'Heading':
      return { w: 320, h: 56 };
    case 'Paragraph':
      return { w: 360, h: 96 };
    default:
      return { w: 180, h: 96 };
  }
}

function styleForVariant(variant, size) {
  const base = {
    width: size === 'small' ? 92 : size === 'large' ? 148 : 120,
    height: size === 'small' ? 34 : size === 'large' ? 52 : 42,
    borderRadius: 8,
    cursor: 'default',
    fontWeight: 700,
  };
  if (variant === 'secondary') return { ...base, background: '#e5e7eb', border: '1px solid #cbd5e1', color: '#111827' };
  if (variant === 'outline') return { ...base, background: 'transparent', border: '1px solid #2563eb', color: '#2563eb' };
  return { ...base, background: '#2563eb', border: '1px solid #2563eb', color: '#ffffff' };
}

function renderNodeContent(node) {
  const props = node.props || {};
  const textStyle = {
    color: props.color || '#111827',
    fontSize: props.fontSize || 16,
    fontWeight: props.fontWeight || '400',
    textAlign: props.textAlign || 'left',
    margin: 0,
  };

  switch (node.type) {
    case 'Heading':
      return <h1 style={textStyle}>{props.content || 'Heading'}</h1>;
    case 'Paragraph':
      return <p style={{ ...textStyle, lineHeight: 1.5 }}>{props.content || 'Paragraph'}</p>;
    case 'Button':
      return <button style={styleForVariant(props.variant, props.size)}>{props.label || 'Button'}</button>;
    case 'Image':
    case 'Avatar':
      return (
        <img
          alt={props.alt || ''}
          src={props.src || ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: props.objectFit || 'cover',
            borderRadius: node.type === 'Avatar' ? '999px' : 8,
            display: 'block',
          }}
        />
      );
    case 'TextField':
      return <input placeholder="Text field" style={{ width: '100%', height: '100%', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 12px' }} />;
    case 'Checkbox':
      return <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#111827' }}><input type="checkbox" /> Checkbox</label>;
    case 'Select':
      return <select style={{ width: '100%', height: '100%', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 12px' }}><option>Select</option></select>;
    case 'Toggle':
      return <div style={{ width: 52, height: 28, borderRadius: 999, background: '#2563eb', padding: 3 }}><div style={{ width: 22, height: 22, borderRadius: 999, background: '#ffffff', marginLeft: 21 }} /></div>;
    case 'Row':
      return <div style={{ display: 'flex', gap: 12, height: '100%' }}><div style={{ flex: 1, background: '#e5e7eb', borderRadius: 8 }} /><div style={{ flex: 1, background: '#dbeafe', borderRadius: 8 }} /></div>;
    case 'Column':
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}><div style={{ flex: 1, background: '#e5e7eb', borderRadius: 8 }} /><div style={{ flex: 1, background: '#dbeafe', borderRadius: 8 }} /></div>;
    case 'Grid':
      return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, height: '100%' }}>{[0, 1, 2, 3].map((item) => <div key={item} style={{ background: '#e5e7eb', borderRadius: 8 }} />)}</div>;
    case 'Spacer':
      return <div style={{ width: '100%', height: '100%', background: 'repeating-linear-gradient(45deg, #f3f4f6, #f3f4f6 6px, #e5e7eb 6px, #e5e7eb 12px)' }} />;
    case 'Table':
      return <div style={{ color: '#111827' }}><strong>Table</strong><div style={{ marginTop: 12, borderTop: '1px solid #d1d5db' }}>Name | Status | Owner</div></div>;
    case 'List':
      return <ul style={{ margin: 0, paddingLeft: 18, color: '#111827' }}><li>First item</li><li>Second item</li><li>Third item</li></ul>;
    case 'Badge':
      return <span style={{ display: 'inline-block', padding: '6px 10px', borderRadius: 8, background: '#dbeafe', color: '#1d4ed8', fontWeight: 700 }}>Badge</span>;
    case 'Icon':
      return <span style={{ color: '#111827', fontSize: 40 }}>★</span>;
    case 'Link':
      return <a style={textStyle} href="#preview" onClick={(event) => event.preventDefault()}>{props.content || 'Link'}</a>;
    case 'Navbar':
      return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#111827', height: '100%' }}><strong>Brand</strong><span>Home Products Contact</span></div>;
    case 'Sidebar':
      return <div style={{ color: '#111827', lineHeight: 2 }}><strong>Menu</strong><div>Dashboard</div><div>Projects</div><div>Settings</div></div>;
    case 'Tabs':
      return <div style={{ display: 'flex', gap: 8 }}><span style={{ borderBottom: '2px solid #2563eb', color: '#111827' }}>Overview</span><span style={{ color: '#6b7280' }}>Details</span></div>;
    case 'Breadcrumb':
      return <div style={{ color: '#6b7280' }}>Home / Library / Page</div>;
    case 'Footer':
      return <div style={{ color: '#111827' }}>© 2026 Generated page</div>;
    default:
      return <div style={{ color: '#111827' }}>{node.type}</div>;
  }
}

function nodeBoxStyle(node, selected) {
  const props = node.props || {};
  const isBox = ['Container', 'Card'].includes(node.type);
  return {
    position: 'absolute',
    left: node.position.x,
    top: node.position.y,
    width: node.size.w,
    height: node.size.h,
    padding: isBox ? `${props.padding?.top || 0}px ${props.padding?.right || 0}px ${props.padding?.bottom || 0}px ${props.padding?.left || 0}px` : 0,
    margin: isBox ? `${props.margin?.top || 0}px ${props.margin?.right || 0}px ${props.margin?.bottom || 0}px ${props.margin?.left || 0}px` : 0,
    background: isBox ? props.backgroundColor || 'transparent' : 'transparent',
    borderRadius: isBox ? props.borderRadius || 0 : 0,
    border: selected ? '2px solid #3b82f6' : isBox ? props.border || '1px dashed #cbd5e1' : '1px solid transparent',
    boxSizing: 'border-box',
    overflow: 'hidden',
    cursor: 'move',
  };
}

function extractCodeBlocks(text) {
  const blocks = [];
  const regex = /```(?:jsx|tsx|javascript|js|react)?\s*([\s\S]*?)```/gi;
  let match = regex.exec(text || '');
  while (match) {
    blocks.push(match[1].trim());
    match = regex.exec(text || '');
  }
  return blocks.length ? blocks : String(text || '').split(/\n\s*---+\s*\n/).map((part) => part.trim()).filter(Boolean);
}

function parseVariants(reply) {
  try {
    const jsonText = String(reply).match(/\[[\s\S]*\]|\{[\s\S]*\}/)?.[0];
    const parsed = JSON.parse(jsonText);
    const variants = Array.isArray(parsed) ? parsed : parsed.variants;
    if (Array.isArray(variants)) {
      return variants.slice(0, 3).map((item, index) => ({
        id: makeId('variant'),
        label: item.label || `Variant ${String.fromCharCode(65 + index)}`,
        code: item.code || item.jsx || String(item),
      }));
    }
  } catch {
    // Fall through to markdown/code block parsing.
  }

  const blocks = extractCodeBlocks(reply);
  return [0, 1, 2].map((index) => ({
    id: makeId('variant'),
    label: `Variant ${String.fromCharCode(65 + index)}`,
    code: blocks[index] || blocks[0] || '<div style={{padding: 32}}>No JSX returned.</div>',
  }));
}

function jsxToPreviewHtml(code) {
  let html = String(code || '');
  html = html.replace(/import[\s\S]*?;\n/g, '');
  html = html.replace(/export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{\s*return\s*\(/, '');
  html = html.replace(/function\s+\w+\s*\([^)]*\)\s*\{\s*return\s*\(/, '');
  html = html.replace(/\);\s*\}\s*$/g, '');
  html = html.replace(/className=/g, 'class=');
  html = html.replace(/htmlFor=/g, 'for=');
  html = html.replace(/\{`([^`]*)`\}/g, '"$1"');
  html = html.replace(/style=\{\{([\s\S]*?)\}\}/g, (_, body) => {
    const css = body
      .replace(/([A-Z])/g, '-$1')
      .replace(/([a-z-]+)\s*:\s*'([^']*)'/g, '$1:$2;')
      .replace(/([a-z-]+)\s*:\s*"([^"]*)"/g, '$1:$2;')
      .replace(/([a-z-]+)\s*:\s*([0-9.]+)/g, '$1:$2px;')
      .replace(/,/g, '');
    return `style="${css.toLowerCase()}"`;
  });
  html = html.replace(/\{['"]([^'"]*)['"]\}/g, '$1');
  html = html.replace(/\s(on[A-Z]\w*)=\{[\s\S]*?\}/g, '');
  return html;
}

function buildIframeDocument(code) {
  return `<!doctype html>
<html>
  <head>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #ffffff; color: #111827; }
      img { max-width: 100%; }
      button { font: inherit; }
    </style>
  </head>
  <body>${jsxToPreviewHtml(code)}</body>
</html>`;
}

function serializeStyle(style) {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? JSON.stringify(value) : value}`)
    .join(', ');
}

function nodeToJsx(node) {
  const props = node.props || {};
  const boxStyle = {
    position: 'absolute',
    left: node.position.x,
    top: node.position.y,
    width: node.size.w,
    height: node.size.h,
    boxSizing: 'border-box',
  };
  const wrapperStart = `      <div style={{ ${serializeStyle(boxStyle)} }}>`;
  const wrapperEnd = '      </div>';

  if (node.type === 'Heading') return `${wrapperStart}\n        <h1 style={{ fontSize: ${props.fontSize || 32}, fontWeight: ${JSON.stringify(props.fontWeight || '700')}, color: ${JSON.stringify(props.color || '#111827')}, textAlign: ${JSON.stringify(props.textAlign || 'left')}, margin: 0 }}>${props.content || 'Heading'}</h1>\n${wrapperEnd}`;
  if (node.type === 'Paragraph') return `${wrapperStart}\n        <p style={{ fontSize: ${props.fontSize || 16}, fontWeight: ${JSON.stringify(props.fontWeight || '400')}, color: ${JSON.stringify(props.color || '#374151')}, textAlign: ${JSON.stringify(props.textAlign || 'left')}, lineHeight: 1.5, margin: 0 }}>${props.content || 'Paragraph'}</p>\n${wrapperEnd}`;
  if (node.type === 'Button') return `${wrapperStart}\n        <button style={{ ${serializeStyle(styleForVariant(props.variant, props.size))} }}>${props.label || 'Button'}</button>\n${wrapperEnd}`;
  if (node.type === 'Image' || node.type === 'Avatar') return `${wrapperStart}\n        <img src=${JSON.stringify(props.src || '')} alt=${JSON.stringify(props.alt || '')} style={{ width: '100%', height: '100%', objectFit: ${JSON.stringify(props.objectFit || 'cover')}, borderRadius: ${node.type === 'Avatar' ? 999 : 8} }} />\n${wrapperEnd}`;
  if (node.type === 'Link') return `${wrapperStart}\n        <a href="#" style={{ fontSize: ${props.fontSize || 16}, fontWeight: ${JSON.stringify(props.fontWeight || '500')}, color: ${JSON.stringify(props.color || '#2563eb')}, textAlign: ${JSON.stringify(props.textAlign || 'left')} }}>${props.content || 'Link'}</a>\n${wrapperEnd}`;

  return `${wrapperStart}\n        <div>${node.type}</div>\n${wrapperEnd}`;
}

function canvasToJsx(nodes) {
  const body = nodes.map(nodeToJsx).join('\n');
  return `import React from 'react';

export default function GeneratedPage() {
  return (
    <main style={{ position: 'relative', minHeight: 720, background: '#ffffff', color: '#111827', fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden' }}>
${body || '      <div />'}
    </main>
  );
}
`;
}

function ControlLabel({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 6, color: '#f0f0f0', fontSize: 12 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function DesignCanvas({ project, onClose, onApply }) {
  const [prompt, setPrompt] = useState('');
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [variants, setVariants] = useState([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [nodes, setNodes] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [activeViewport, setActiveViewport] = useState('desktop');
  const [showAllViewports, setShowAllViewports] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [status, setStatus] = useState('');
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedId) || null, [nodes, selectedId]);
  const selectedVariant = useMemo(() => variants.find((variant) => variant.id === selectedVariantId) || variants[0] || null, [variants, selectedVariantId]);
  const activeWidth = VIEWPORTS.find((viewport) => viewport.key === activeViewport)?.width || 1280;

  const setNodesWithHistory = useCallback((updater) => {
    setNodes((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (next === current) return current;
      setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), current]);
      setRedoStack([]);
      return next;
    });
  }, []);

  const updateNode = useCallback((id, updater, withHistory = true) => {
    const apply = (current) => current.map((node) => (node.id === id ? { ...node, ...updater(node) } : node));
    if (withHistory) setNodesWithHistory(apply);
    else setNodes(apply);
  }, [setNodesWithHistory]);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const previous = stack[stack.length - 1];
      setRedoStack((redo) => [...redo.slice(-(HISTORY_LIMIT - 1)), nodes]);
      setNodes(previous);
      setSelectedId('');
      return stack.slice(0, -1);
    });
  }, [nodes]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((undoHistory) => [...undoHistory.slice(-(HISTORY_LIMIT - 1)), nodes]);
      setNodes(next);
      setSelectedId('');
      return stack.slice(0, -1);
    });
  }, [nodes]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')) {
        event.preventDefault();
        setNodesWithHistory((current) => current.filter((node) => node.id !== selectedId));
        setSelectedId('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, selectedId, setNodesWithHistory, undo]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (drag.kind === 'move') {
        updateNode(drag.id, () => ({
          position: { x: Math.max(0, snap(drag.startPosition.x + dx)), y: Math.max(0, snap(drag.startPosition.y + dy)) },
        }), false);
      }

      if (drag.kind === 'resize') {
        const nextPosition = { ...drag.startPosition };
        const nextSize = { ...drag.startSize };
        if (drag.handle.includes('e')) nextSize.w = Math.max(32, snap(drag.startSize.w + dx));
        if (drag.handle.includes('s')) nextSize.h = Math.max(24, snap(drag.startSize.h + dy));
        if (drag.handle.includes('w')) {
          nextPosition.x = Math.max(0, snap(drag.startPosition.x + dx));
          nextSize.w = Math.max(32, snap(drag.startSize.w - dx));
        }
        if (drag.handle.includes('n')) {
          nextPosition.y = Math.max(0, snap(drag.startPosition.y + dy));
          nextSize.h = Math.max(24, snap(drag.startSize.h - dy));
        }
        updateNode(drag.id, () => ({ position: nextPosition, size: nextSize }), false);
      }
    };

    const handlePointerUp = () => {
      const drag = dragRef.current;
      if (drag) {
        setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), drag.originalNodes]);
        setRedoStack([]);
      }
      dragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [updateNode]);

  const requestVariants = async (extraInstruction = '') => {
    const basePrompt = prompt.trim();
    if (!basePrompt || loading) return;
    setLoading(true);
    setError('');
    setStatus('');

    const systemPrompt = `You are an expert React UI designer. Return exactly 3 distinct React component variants for the requested page. Each variant must be a self-contained JSX component with inline styles only, no imports except React, no external CSS, no libraries, and no explanations. Prefer complete visual page sections.`;
    const message = `${systemPrompt}

User request: ${basePrompt}
${extraInstruction ? `Modification request: ${extraInstruction}` : ''}

Format your response as three fenced jsx code blocks, one for Variant A, Variant B, and Variant C.`;

    try {
      let response;
      try {
        response = await api.post(`/ai/${encodeURIComponent(project || 'default')}/chat`, { message, project });
      } catch (err) {
        if (err.response?.status !== 404) throw err;
        response = await api.post('/ai/chat', { message, project });
      }
      const nextVariants = parseVariants(response.data?.reply || response.data?.message || response.data?.content || '');
      setVariants(nextVariants);
      setSelectedVariantId(nextVariants[0]?.id || '');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || 'AI generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-design-component');
    if (!type || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const node = {
      id: makeId(type.toLowerCase()),
      type,
      props: defaultProps(type),
      position: { x: Math.max(0, snap(event.clientX - rect.left)), y: Math.max(0, snap(event.clientY - rect.top)) },
      size: defaultSize(type),
      children: [],
    };
    setNodesWithHistory((current) => [...current, node]);
    setSelectedId(node.id);
  };

  const startMove = (event, node) => {
    event.stopPropagation();
    setSelectedId(node.id);
    dragRef.current = {
      kind: 'move',
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: node.position,
      originalNodes: nodes,
    };
  };

  const startResize = (event, node, handle) => {
    event.stopPropagation();
    dragRef.current = {
      kind: 'resize',
      id: node.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: node.position,
      startSize: node.size,
      originalNodes: nodes,
    };
  };

  const updateProp = (key, value) => {
    if (!selectedNode) return;
    setNodesWithHistory((current) => current.map((node) => (
      node.id === selectedNode.id ? { ...node, props: { ...node.props, [key]: value } } : node
    )));
  };

  const updateSpacing = (key, side, value) => {
    if (!selectedNode) return;
    setNodesWithHistory((current) => current.map((node) => (
      node.id === selectedNode.id
        ? { ...node, props: { ...node.props, [key]: { ...(node.props[key] || {}), [side]: parsePx(value) } } }
        : node
    )));
  };

  const copyJsx = async () => {
    const code = selectedVariant?.code || canvasToJsx(nodes);
    await navigator.clipboard.writeText(code);
    setStatus('JSX copied to clipboard.');
  };

  const applyToProject = async () => {
    const code = canvasToJsx(nodes);
    const filename = DEFAULT_FILE;
    const parts = filename.split('/');
    const name = parts.pop();
    const parentPath = parts.join('/');
    setStatus('Writing GeneratedPage.jsx...');
    setError('');
    try {
      try {
        await api.post(`/files/${encodeURIComponent(project)}`, { name, type: 'file', path: parentPath });
      } catch (err) {
        if (err.response?.status !== 409) throw err;
      }
      await api.put(`/files/${encodeURIComponent(project)}`, { path: filename, content: code });
      setStatus(`Applied to ${filename}.`);
      onApply?.(filename, code);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to apply generated file');
    }
  };

  const inputStyle = {
    width: '100%',
    background: '#252525',
    color: '#f0f0f0',
    border: '1px solid #333',
    borderRadius: 8,
    padding: '9px 10px',
    boxSizing: 'border-box',
  };
  const buttonStyle = {
    background: '#333',
    color: '#f0f0f0',
    border: '1px solid #444',
    borderRadius: 8,
    padding: '9px 12px',
    cursor: 'pointer',
  };
  const primaryButtonStyle = { ...buttonStyle, background: '#2563eb', borderColor: '#3b82f6', color: '#ffffff' };

  const renderCanvas = (width, label) => (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'center', minWidth: showAllViewports ? Math.min(width, 420) : 'auto' }}>
      {showAllViewports && <div style={{ color: '#bdbdbd', fontSize: 12 }}>{label} ({width}px)</div>}
      <div
        ref={!showAllViewports ? canvasRef : null}
        onDragOver={(event) => event.preventDefault()}
        onDrop={!showAllViewports ? handleDrop : undefined}
        onClick={() => setSelectedId('')}
        style={{
          position: 'relative',
          width: showAllViewports ? Math.min(width, 420) : width,
          maxWidth: '100%',
          minHeight: 720,
          background: '#ffffff',
          color: '#111827',
          border: '1px solid #333',
          boxShadow: '0 20px 80px rgba(0, 0, 0, 0.35)',
          overflow: 'hidden',
          backgroundImage: 'linear-gradient(#f3f4f6 1px, transparent 1px), linear-gradient(90deg, #f3f4f6 1px, transparent 1px)',
          backgroundSize: '8px 8px',
          transformOrigin: 'top center',
        }}
      >
        {nodes.map((node) => (
          <div
            key={node.id}
            onPointerDown={(event) => !showAllViewports && startMove(event, node)}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedId(node.id);
            }}
            style={nodeBoxStyle(node, selectedId === node.id && !showAllViewports)}
          >
            {renderNodeContent(node)}
            {selectedId === node.id && !showAllViewports && HANDLE_POSITIONS.map((handle) => (
              <span
                key={handle}
                onPointerDown={(event) => startResize(event, node, handle)}
                style={{
                  position: 'absolute',
                  width: 10,
                  height: 10,
                  background: '#3b82f6',
                  border: '1px solid #ffffff',
                  borderRadius: 2,
                  left: handle.includes('w') ? -5 : handle.includes('e') ? 'calc(100% - 5px)' : 'calc(50% - 5px)',
                  top: handle.includes('n') ? -5 : handle.includes('s') ? 'calc(100% - 5px)' : 'calc(50% - 5px)',
                  cursor: `${handle}-resize`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#1e1e1e', color: '#f0f0f0', display: 'grid', gridTemplateRows: '56px 156px 1fr 56px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', borderBottom: '1px solid #333', background: '#1e1e1e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong style={{ fontSize: 18 }}>Design Canvas</strong>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>{project || 'No project selected'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={buttonStyle} onClick={undo} disabled={!undoStack.length}>Undo</button>
          <button style={buttonStyle} onClick={redo} disabled={!redoStack.length}>Redo</button>
          <button style={buttonStyle} onClick={copyJsx}>Copy JSX</button>
          <button style={primaryButtonStyle} onClick={applyToProject} disabled={!project}>Apply to Project</button>
          <button style={{ ...buttonStyle, width: 36, padding: 8 }} onClick={onClose} aria-label="Close Design Canvas">X</button>
        </div>
      </header>

      <section style={{ borderBottom: '1px solid #333', padding: 14, display: 'grid', gap: 12, background: '#202020' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10 }}>
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the page you want to design..." style={inputStyle} />
          <button style={primaryButtonStyle} onClick={() => requestVariants()} disabled={loading || !prompt.trim()}>{loading ? 'Generating...' : 'Generate 3 Variants'}</button>
          <button style={buttonStyle} onClick={() => requestVariants()} disabled={loading || !prompt.trim()}>Regenerate</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr)) 260px', gap: 10, minHeight: 82 }}>
          {loading ? [0, 1, 2].map((item) => <div key={item} style={{ border: '1px solid #333', borderRadius: 8, background: 'linear-gradient(90deg, #252525, #303030, #252525)', minHeight: 76 }} />) : variants.map((variant, index) => (
            <div key={variant.id} style={{ border: selectedVariantId === variant.id ? '1px solid #3b82f6' : '1px solid #333', borderRadius: 8, overflow: 'hidden', background: '#252525', display: 'grid', gridTemplateRows: '28px 1fr' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px', borderBottom: '1px solid #333', fontSize: 12 }}>
                <span>{`Variant ${String.fromCharCode(65 + index)}`}</span>
                <button style={{ ...buttonStyle, padding: '3px 8px', fontSize: 12 }} onClick={() => setSelectedVariantId(variant.id)}>Select</button>
              </div>
              <iframe title={variant.label} sandbox="" srcDoc={buildIframeDocument(variant.code)} style={{ width: '100%', height: 48, border: 0, background: '#ffffff' }} />
            </div>
          ))}
          {!loading && variants.length === 0 && <div style={{ gridColumn: '1 / 4', border: '1px dashed #333', borderRadius: 8, color: '#9ca3af', display: 'grid', placeItems: 'center' }}>AI variants will appear here.</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            <input value={modifyPrompt} onChange={(event) => setModifyPrompt(event.target.value)} placeholder="Modify selected variant..." style={inputStyle} />
            <button style={buttonStyle} onClick={() => requestVariants(modifyPrompt)} disabled={loading || !modifyPrompt.trim() || !selectedVariant}>Modify</button>
          </div>
        </div>
      </section>

      <main style={{ display: 'grid', gridTemplateColumns: '200px 1fr 250px', minHeight: 0 }}>
        <aside style={{ borderRight: '1px solid #333', padding: 12, overflow: 'auto', background: '#1e1e1e' }}>
          {PALETTE.map((group) => (
            <div key={group.group} style={{ marginBottom: 16 }}>
              <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 8 }}>{group.group}</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {group.items.map((item) => (
                  <div
                    key={item}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('application/x-design-component', item)}
                    style={{ border: '1px solid #333', borderRadius: 8, padding: '8px 10px', background: '#252525', cursor: 'grab', fontSize: 13 }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <section style={{ overflow: 'auto', padding: 24, background: '#181818' }}>
          <div style={{ display: 'flex', gap: 18, justifyContent: showAllViewports ? 'flex-start' : 'center', alignItems: 'flex-start', minWidth: showAllViewports ? 1280 : 0 }}>
            {showAllViewports ? VIEWPORTS.map((viewport) => renderCanvas(viewport.width, viewport.label)) : renderCanvas(activeWidth, activeViewport)}
          </div>
        </section>

        <aside style={{ borderLeft: '1px solid #333', padding: 12, overflow: 'auto', background: '#1e1e1e' }}>
          <strong>Properties</strong>
          {!selectedNode && <p style={{ color: '#9ca3af', fontSize: 13 }}>Select a component on the canvas.</p>}
          {selectedNode && (
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <div style={{ color: '#9ca3af', fontSize: 12 }}>{selectedNode.type}</div>
              {['Heading', 'Paragraph', 'Link'].includes(selectedNode.type) && (
                <>
                  <ControlLabel label="Content"><input style={inputStyle} value={selectedNode.props.content || ''} onChange={(event) => updateProp('content', event.target.value)} /></ControlLabel>
                  <ControlLabel label="Font Size"><input style={inputStyle} type="number" value={selectedNode.props.fontSize || 16} onChange={(event) => updateProp('fontSize', parsePx(event.target.value, 16))} /></ControlLabel>
                  <ControlLabel label="Font Weight"><input style={inputStyle} value={selectedNode.props.fontWeight || '400'} onChange={(event) => updateProp('fontWeight', event.target.value)} /></ControlLabel>
                  <ControlLabel label="Color"><div style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 8 }}><span style={{ background: selectedNode.props.color || '#111827', border: '1px solid #333', borderRadius: 8 }} /><input style={inputStyle} value={selectedNode.props.color || ''} onChange={(event) => updateProp('color', event.target.value)} /></div></ControlLabel>
                  <ControlLabel label="Text Align"><select style={inputStyle} value={selectedNode.props.textAlign || 'left'} onChange={(event) => updateProp('textAlign', event.target.value)}><option>left</option><option>center</option><option>right</option></select></ControlLabel>
                </>
              )}
              {selectedNode.type === 'Button' && (
                <>
                  <ControlLabel label="Label"><input style={inputStyle} value={selectedNode.props.label || ''} onChange={(event) => updateProp('label', event.target.value)} /></ControlLabel>
                  <ControlLabel label="Variant"><select style={inputStyle} value={selectedNode.props.variant || 'primary'} onChange={(event) => updateProp('variant', event.target.value)}><option>primary</option><option>secondary</option><option>outline</option></select></ControlLabel>
                  <ControlLabel label="Size"><select style={inputStyle} value={selectedNode.props.size || 'medium'} onChange={(event) => updateProp('size', event.target.value)}><option>small</option><option>medium</option><option>large</option></select></ControlLabel>
                  <ControlLabel label="onClick"><input style={inputStyle} value={selectedNode.props.onClick || ''} onChange={(event) => updateProp('onClick', event.target.value)} /></ControlLabel>
                </>
              )}
              {['Container', 'Card'].includes(selectedNode.type) && (
                <>
                  <ControlLabel label="Background"><div style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 8 }}><span style={{ background: selectedNode.props.backgroundColor || 'transparent', border: '1px solid #333', borderRadius: 8 }} /><input style={inputStyle} value={selectedNode.props.backgroundColor || ''} onChange={(event) => updateProp('backgroundColor', event.target.value)} /></div></ControlLabel>
                  <ControlLabel label="Border Radius"><input style={inputStyle} type="number" value={selectedNode.props.borderRadius || 0} onChange={(event) => updateProp('borderRadius', parsePx(event.target.value))} /></ControlLabel>
                  <ControlLabel label="Border"><input style={inputStyle} value={selectedNode.props.border || ''} onChange={(event) => updateProp('border', event.target.value)} /></ControlLabel>
                  {['padding', 'margin'].map((key) => <div key={key} style={{ display: 'grid', gap: 6 }}><span style={{ color: '#9ca3af', fontSize: 12 }}>{key}</span><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>{['top', 'right', 'bottom', 'left'].map((side) => <input key={side} aria-label={`${key} ${side}`} style={inputStyle} type="number" value={selectedNode.props[key]?.[side] || 0} onChange={(event) => updateSpacing(key, side, event.target.value)} />)}</div></div>)}
                </>
              )}
              {['Image', 'Avatar'].includes(selectedNode.type) && (
                <>
                  <ControlLabel label="Source"><input style={inputStyle} value={selectedNode.props.src || ''} onChange={(event) => updateProp('src', event.target.value)} /></ControlLabel>
                  <ControlLabel label="Alt"><input style={inputStyle} value={selectedNode.props.alt || ''} onChange={(event) => updateProp('alt', event.target.value)} /></ControlLabel>
                  <ControlLabel label="Object Fit"><select style={inputStyle} value={selectedNode.props.objectFit || 'cover'} onChange={(event) => updateProp('objectFit', event.target.value)}><option>cover</option><option>contain</option><option>fill</option></select></ControlLabel>
                  <ControlLabel label="Width"><input style={inputStyle} type="number" value={selectedNode.size.w} onChange={(event) => updateNode(selectedNode.id, () => ({ size: { ...selectedNode.size, w: parsePx(event.target.value, selectedNode.size.w) } }))} /></ControlLabel>
                  <ControlLabel label="Height"><input style={inputStyle} type="number" value={selectedNode.size.h} onChange={(event) => updateNode(selectedNode.id, () => ({ size: { ...selectedNode.size, h: parsePx(event.target.value, selectedNode.size.h) } }))} /></ControlLabel>
                </>
              )}
            </div>
          )}
          {(error || status) && <div style={{ marginTop: 14, color: error ? '#f87171' : '#93c5fd', fontSize: 12 }}>{error || status}</div>}
        </aside>
      </main>

      <footer style={{ borderTop: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#202020' }}>
        {VIEWPORTS.map((viewport) => (
          <button key={viewport.key} style={activeViewport === viewport.key ? primaryButtonStyle : buttonStyle} onClick={() => setActiveViewport(viewport.key)}>
            {viewport.label} ({viewport.width}px)
          </button>
        ))}
        <button style={showAllViewports ? primaryButtonStyle : buttonStyle} onClick={() => setShowAllViewports((value) => !value)}>Side-by-side</button>
      </footer>
    </div>
  );
}
