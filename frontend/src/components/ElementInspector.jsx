import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api';

const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|html?|css|scss|sass|less|mdx?|json|vue|svelte)$/i;

const INSPECT_SCRIPT = `
(function() {
  if (window.__inspectorActive) return;
  window.__inspectorActive = true;
  window.__inspectorEditingEl = null;

  var overlay = document.createElement('div');
  overlay.id = '__inspector-overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #007acc;background:rgba(0,122,204,0.08);z-index:99999;transition:all 0.05s;display:none;';
  document.body.appendChild(overlay);

  var label = document.createElement('div');
  label.id = '__inspector-label';
  label.style.cssText = 'position:fixed;z-index:100000;background:#007acc;color:#fff;font:11px/1.4 monospace;padding:2px 6px;border-radius:2px;pointer-events:none;display:none;white-space:nowrap;';
  document.body.appendChild(label);

  function getSelector(el) {
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    var s = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).join('.');
    return s;
  }

  function buildUniqueSelector(el) {
    if (el.id) return '#' + el.id;
    var path = [];
    while (el && el !== document.body && el !== document.documentElement) {
      var s = el.tagName.toLowerCase();
      if (el.id) {
        path.unshift('#' + el.id);
        break;
      }
      if (el.className && typeof el.className === 'string') {
        s += '.' + el.className.trim().split(/\\s+/).join('.');
      }
      var parent = el.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(child) { return child.tagName === el.tagName; });
        if (siblings.length > 1) {
          s += ':nth-child(' + (Array.from(parent.children).indexOf(el) + 1) + ')';
        }
      }
      path.unshift(s);
      el = parent;
    }
    return path.join(' > ');
  }

  function getEditableText(el) {
    return (el.innerText || el.textContent || '').replace(/\\r\\n/g, '\\n');
  }

  function isTextTarget(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return false;
    if (['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'SVG', 'PATH', 'VIDEO', 'AUDIO', 'CANVAS'].includes(el.tagName)) return false;
    if (el.childElementCount > 0) return false;
    return getEditableText(el).trim().length > 0;
  }

  function getElementType(el) {
    if (!el || !el.tagName) return 'other';
    if (el.tagName === 'IMG') return 'image';
    if (isTextTarget(el)) return 'text';
    return 'other';
  }

  function getElementData(el) {
    var rect = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    var textValue = getEditableText(el);
    return {
      tagName: el.tagName.toLowerCase(),
      className: el.className || '',
      id: el.id || '',
      textContent: textValue,
      sourceText: (el.textContent || '').replace(/\\r\\n/g, '\\n'),
      src: el.currentSrc || el.src || '',
      sourceAttribute: el.getAttribute ? (el.getAttribute('src') || '') : '',
      elementType: getElementType(el),
      computedStyles: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        margin: cs.margin,
        padding: cs.padding,
        display: cs.display,
        width: cs.width,
        height: cs.height,
        position: cs.position,
        marginTop: cs.marginTop,
        marginRight: cs.marginRight,
        marginBottom: cs.marginBottom,
        marginLeft: cs.marginLeft,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        borderRadius: cs.borderRadius,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        textAlign: cs.textAlign,
        opacity: cs.opacity
      },
      boundingRect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      },
      selector: buildUniqueSelector(el)
    };
  }

  function postSelection(el, extra) {
    window.parent.postMessage({
      type: 'element-selected',
      data: Object.assign({}, getElementData(el), extra || {})
    }, '*');
  }

  function finishTextEdit(el, oldText, commit) {
    if (!el) return;
    var newText = getEditableText(el);
    el.removeAttribute('contenteditable');
    el.spellcheck = false;
    el.style.outline = '';
    window.__inspectorEditingEl = null;
    if (!commit) {
      el.textContent = oldText;
      postSelection(el, { textContent: oldText, sourceText: oldText, elementType: 'text' });
      return;
    }
    if (newText === oldText) {
      postSelection(el, { textContent: oldText, sourceText: oldText, elementType: 'text' });
      return;
    }
    window.parent.postMessage({
      type: 'text-edit-commit',
      data: Object.assign({}, getElementData(el), {
        elementType: 'text',
        oldText: oldText,
        newText: newText
      })
    }, '*');
  }

  function startTextEdit(el) {
    if (!isTextTarget(el)) {
      postSelection(el);
      return;
    }
    if (window.__inspectorEditingEl && window.__inspectorEditingEl !== el) {
      return;
    }

    var oldText = getEditableText(el);
    window.__inspectorEditingEl = el;
    overlay.style.display = 'none';
    label.style.display = 'none';
    el.setAttribute('contenteditable', 'plaintext-only');
    el.spellcheck = false;
    el.style.outline = '2px solid rgba(0, 122, 204, 0.85)';
    el.focus();

    var selection = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);

    function handleBlur() {
      cleanup();
      finishTextEdit(el, oldText, true);
    }

    function handleKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        el.blur();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
        finishTextEdit(el, oldText, false);
      }
    }

    function cleanup() {
      el.removeEventListener('blur', handleBlur);
      el.removeEventListener('keydown', handleKeyDown, true);
    }

    el.addEventListener('blur', handleBlur, { once: true });
    el.addEventListener('keydown', handleKeyDown, true);
  }

  window.__inspectorMouseOver = function(e) {
    if (window.__inspectorEditingEl) return;
    var el = e.target;
    if (!el || el.id === '__inspector-overlay' || el.id === '__inspector-label') return;
    var rect = el.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';
    label.textContent = getSelector(el) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height);
    label.style.top = Math.max(0, rect.top - 22) + 'px';
    label.style.left = rect.left + 'px';
    label.style.display = 'block';
  };

  window.__inspectorClick = function(e) {
    if (window.__inspectorEditingEl) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (!el || el.id === '__inspector-overlay' || el.id === '__inspector-label') return;
    var elementType = getElementType(el);
    if (elementType === 'text') {
      startTextEdit(el);
      return;
    }
    if (elementType === 'image') {
      window.parent.postMessage({
        type: 'image-edit-request',
        data: Object.assign({}, getElementData(el), { elementType: 'image' })
      }, '*');
      return;
    }
    postSelection(el, { elementType: elementType });
  };

  document.addEventListener('mouseover', window.__inspectorMouseOver, true);
  document.addEventListener('click', window.__inspectorClick, true);
})();
`;

const DISABLE_SCRIPT = `
(function() {
  window.__inspectorActive = false;
  if (window.__inspectorEditingEl && window.__inspectorEditingEl.blur) {
    window.__inspectorEditingEl.blur();
  }
  var ov = document.getElementById('__inspector-overlay');
  var lb = document.getElementById('__inspector-label');
  if (ov) ov.remove();
  if (lb) lb.remove();
  if (window.__inspectorMouseOver) document.removeEventListener('mouseover', window.__inspectorMouseOver, true);
  if (window.__inspectorClick) document.removeEventListener('click', window.__inspectorClick, true);
  window.__inspectorMouseOver = null;
  window.__inspectorClick = null;
  window.__inspectorEditingEl = null;
})();
`;

function escapeSearchQuery(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePosix(value) {
  const input = (value || '').replace(/\\/g, '/');
  const absolute = input.startsWith('/');
  const parts = input.split('/');
  const output = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (output.length && output[output.length - 1] !== '..') {
        output.pop();
      } else if (!absolute) {
        output.push('..');
      }
      continue;
    }
    output.push(part);
  }

  const result = `${absolute ? '/' : ''}${output.join('/')}`;
  return result || (absolute ? '/' : '.');
}

function joinPosix(...parts) {
  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return '.';
  return normalizePosix(filtered.join('/'));
}

function dirnamePosix(value) {
  const normalized = normalizePosix(value);
  if (normalized === '.' || normalized === '/') return normalized;
  const idx = normalized.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return normalized.slice(0, idx);
}

function relativePosix(from, to) {
  const fromParts = normalizePosix(from).split('/').filter(Boolean);
  const toParts = normalizePosix(to).split('/').filter(Boolean);
  let index = 0;

  while (index < fromParts.length && index < toParts.length && fromParts[index] === toParts[index]) {
    index += 1;
  }

  const up = new Array(fromParts.length - index).fill('..');
  const down = toParts.slice(index);
  return [...up, ...down].join('/') || '.';
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildSearchTerms(...values) {
  const terms = [];

  for (const value of values) {
    if (!value || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) terms.push(trimmed);
    const lines = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (lines[0]) terms.push(lines[0]);
  }

  return unique(terms);
}

function sortCandidateFiles(results) {
  return unique(results.map((result) => result.file)).sort((a, b) => {
    const aScore = SOURCE_FILE_RE.test(a) ? 0 : 1;
    const bScore = SOURCE_FILE_RE.test(b) ? 0 : 1;
    if (aScore !== bScore) return aScore - bScore;
    return a.localeCompare(b);
  });
}

async function findExactMatchInProject(project, searchTerms, exactNeedles) {
  let searchResults = [];

  for (const term of unique(searchTerms)) {
    if (!term) continue;
    const response = await api.get(`/search/${encodeURIComponent(project)}`, {
      params: { q: escapeSearchQuery(term) },
    });
    if (Array.isArray(response.data) && response.data.length > 0) {
      searchResults = response.data;
      break;
    }
  }

  if (searchResults.length === 0) return null;

  for (const file of sortCandidateFiles(searchResults)) {
    const response = await api.get(`/files/${encodeURIComponent(project)}/content`, {
      params: { path: file },
    });
    const content = response.data?.content ?? '';
    for (const needle of unique(exactNeedles)) {
      if (!needle) continue;
      const index = content.indexOf(needle);
      if (index !== -1) {
        return { file, content, needle, index };
      }
    }
  }

  return null;
}

function replaceFirstOccurrence(content, needle, replacement) {
  const index = content.indexOf(needle);
  if (index === -1) return null;
  return `${content.slice(0, index)}${replacement}${content.slice(index + needle.length)}`;
}

function isExternalSrc(src) {
  return /^(?:https?:)?\/\//i.test(src) || /^(?:data|blob):/i.test(src);
}

function buildImageUploadPlan(sourceFile, originalSrc, fileName) {
  const safeName = (fileName || 'image').replace(/\s+/g, '-');

  if (isExternalSrc(originalSrc)) {
    return {
      uploadDir: 'public/uploads',
      replacementRef: `/uploads/${safeName}`,
    };
  }

  if (originalSrc.startsWith('/')) {
    const assetDir = dirnamePosix(originalSrc.slice(1));
    return {
      uploadDir: assetDir === '.' ? 'public' : joinPosix('public', assetDir),
      replacementRef: `/${assetDir === '.' ? safeName : `${assetDir}/${safeName}`}`,
    };
  }

  const originalDir = dirnamePosix(originalSrc);
  const sourceDir = dirnamePosix(sourceFile);
  const uploadDir = originalDir === '.' ? sourceDir : joinPosix(sourceDir, originalDir);
  const relativeRef = originalDir === '.' ? safeName : joinPosix(originalDir, safeName);

  return {
    uploadDir: uploadDir === '.' ? '' : uploadDir,
    replacementRef: originalSrc.startsWith('./') && !relativeRef.startsWith('.') ? `./${relativeRef}` : relativeRef,
  };
}

export default function ElementInspector({
  active,
  iframeRef,
  project,
  selectedElement,
  onSelectElement,
}) {
  const [status, setStatus] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef(null);
  const pendingImageRef = useRef(null);

  const injectInspector = useCallback(() => {
    const iframe = iframeRef?.current;
    if (!iframe) return;

    try {
      const iframeWin = iframe.contentWindow;
      if (!iframeWin) return;
      iframeWin.eval(active ? INSPECT_SCRIPT : DISABLE_SCRIPT);
    } catch (_error) {
      iframe.contentWindow?.postMessage({
        type: active ? 'enable-inspector' : 'disable-inspector',
        script: active ? INSPECT_SCRIPT : DISABLE_SCRIPT,
      }, '*');
    }
  }, [active, iframeRef]);

  const updateIframeElement = useCallback((selector, updater) => {
    if (!selector || !iframeRef?.current?.contentWindow || typeof updater !== 'function') return;

    try {
      updater(iframeRef.current.contentWindow.document.querySelector(selector));
    } catch (_error) {
      // Ignore cross-origin access failures; the file save still updates the source.
    }
  }, [iframeRef]);

  const commitProjectReplacement = useCallback(async (oldValue, newValue, extraNeedles = []) => {
    if (!project) {
      throw new Error('No project selected');
    }

    const match = await findExactMatchInProject(
      project,
      buildSearchTerms(oldValue, ...extraNeedles),
      [oldValue, ...extraNeedles]
    );

    if (!match) {
      throw new Error('Could not find the selected content in project files');
    }

    const updatedContent = replaceFirstOccurrence(match.content, match.needle, newValue);
    if (updatedContent == null) {
      throw new Error('Exact match disappeared before save');
    }

    await api.put(`/files/${encodeURIComponent(project)}`, {
      path: match.file,
      content: updatedContent,
    });

    return match.file;
  }, [project]);

  const handleTextCommit = useCallback(async (payload) => {
    if (!payload?.oldText || payload.newText == null) return;

    const nextSelection = {
      ...payload,
      textContent: payload.newText,
      sourceText: payload.newText,
      elementType: 'text',
    };

    onSelectElement(nextSelection);
    setBusy(true);
    setStatus({ type: '', text: '' });

    try {
      const file = await commitProjectReplacement(payload.oldText, payload.newText, [payload.sourceText]);
      updateIframeElement(payload.selector, (elementNode) => {
        if (elementNode) {
          elementNode.textContent = payload.newText;
        }
      });
      setStatus({ type: 'success', text: `Saved text change in ${file}` });
    } catch (error) {
      setStatus({ type: 'error', text: error.response?.data?.error || error.message });
      updateIframeElement(payload.selector, (elementNode) => {
        if (elementNode) {
          elementNode.textContent = payload.oldText;
        }
      });
      onSelectElement({
        ...payload,
        textContent: payload.oldText,
        sourceText: payload.oldText,
        elementType: 'text',
      });
      injectInspector();
    } finally {
      setBusy(false);
    }
  }, [commitProjectReplacement, injectInspector, onSelectElement, updateIframeElement]);

  const beginImageReplace = useCallback((payload) => {
    pendingImageRef.current = payload;
    onSelectElement(payload);
    setStatus({ type: '', text: '' });
    requestAnimationFrame(() => {
      imageInputRef.current?.click();
    });
  }, [onSelectElement]);

  const handleImageFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    const payload = pendingImageRef.current;
    event.target.value = '';

    if (!file || !payload?.sourceAttribute) return;
    if (!project) {
      setStatus({ type: 'error', text: 'No project selected' });
      return;
    }

    setBusy(true);
    setStatus({ type: '', text: '' });

    try {
      const match = await findExactMatchInProject(
        project,
        buildSearchTerms(payload.sourceAttribute, payload.src),
        [payload.sourceAttribute, payload.src]
      );

      if (!match) {
        throw new Error('Could not find the image source in project files');
      }

      const plan = buildImageUploadPlan(match.file, payload.sourceAttribute, file.name);
      const formData = new FormData();
      formData.append('files', file);

      await api.post(
        `/files/${encodeURIComponent(project)}/upload${plan.uploadDir ? `?path=${encodeURIComponent(plan.uploadDir)}` : ''}`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      const updatedContent = replaceFirstOccurrence(match.content, match.needle, plan.replacementRef);
      if (updatedContent == null) {
        throw new Error('Exact image source disappeared before save');
      }

      await api.put(`/files/${encodeURIComponent(project)}`, {
        path: match.file,
        content: updatedContent,
      });

      onSelectElement({
        ...payload,
        src: plan.replacementRef,
        sourceAttribute: plan.replacementRef,
        elementType: 'image',
      });
      updateIframeElement(payload.selector, (elementNode) => {
        if (elementNode && elementNode.tagName === 'IMG') {
          elementNode.setAttribute('src', plan.replacementRef);
        }
      });
      setStatus({ type: 'success', text: `Uploaded image and updated ${match.file}` });
    } catch (error) {
      setStatus({ type: 'error', text: error.response?.data?.error || error.message });
    } finally {
      setBusy(false);
      pendingImageRef.current = null;
    }
  }, [onSelectElement, project, updateIframeElement]);

  useEffect(() => {
    const handler = (event) => {
      if (!event.data?.type) return;

      if (event.data.type === 'element-selected') {
        onSelectElement(event.data.data);
      }

      if (event.data.type === 'text-edit-commit') {
        handleTextCommit(event.data.data);
      }

      if (event.data.type === 'image-edit-request') {
        beginImageReplace(event.data.data);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [beginImageReplace, handleTextCommit, onSelectElement]);

  useEffect(() => {
    injectInspector();
    const iframe = iframeRef?.current;
    if (!iframe) return undefined;

    iframe.addEventListener('load', injectInspector);
    return () => iframe.removeEventListener('load', injectInspector);
  }, [iframeRef, injectInspector]);

  useEffect(() => {
    if (!selectedElement) {
      setStatus((current) => (current.type === 'error' ? current : { type: '', text: '' }));
    }
  }, [selectedElement]);

  const element = selectedElement;
  const selectorDisplay = useMemo(() => {
    if (!element) return '';
    if (element.id) return `#${element.id}`;
    if (element.className) {
      const className = typeof element.className === 'string'
        ? element.className.trim().split(/\s+/).join('.')
        : '';
      return `${element.tagName}.${className}`;
    }
    return element.tagName;
  }, [element]);

  const isText = element?.elementType === 'text';
  const isImage = element?.elementType === 'image';

  return (
    <div className="element-inspector" style={{ background: '#1e1e1e', color: '#d4d4d4' }}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageFileChange}
      />

      <div className="inspector-header">
        <span className="inspector-icon">&#x25CE;</span>
        <span className="inspector-title">Element Inspector</span>
      </div>

      {!element && (
        <div className="inspector-section">
          <div className="inspector-detail">Click text to edit inline, click an image to replace it, or click any other element to inspect styles.</div>
        </div>
      )}

      {element && (
        <>
          <div className="inspector-section">
            <div className="inspector-tag">&lt;{element.tagName}&gt;</div>
            <div className="inspector-detail"><span className="inspector-label">type</span> {element.elementType || 'other'}</div>
            {element.id && <div className="inspector-detail"><span className="inspector-label">id</span> {element.id}</div>}
            {element.className && <div className="inspector-detail"><span className="inspector-label">class</span> {typeof element.className === 'string' ? element.className : ''}</div>}
            {selectorDisplay && <div className="inspector-detail"><span className="inspector-label">target</span> {selectorDisplay}</div>}
            {isText && (
              <div className="inspector-detail">
                <span className="inspector-label">text</span>
                <span className="inspector-text-preview">{element.textContent}</span>
              </div>
            )}
            {isImage && (
              <>
                <div className="inspector-detail">
                  <span className="inspector-label">src</span>
                  <span className="inspector-text-preview">{element.sourceAttribute || element.src}</span>
                </div>
                <button
                  type="button"
                  className="style-editor-save-btn"
                  onClick={() => beginImageReplace(element)}
                  disabled={busy}
                >
                  {busy ? 'Working...' : 'Replace Image'}
                </button>
              </>
            )}
            {isText && (
              <div className="inspector-detail">Edit the text directly in the preview. Press `Enter` or click away to save.</div>
            )}
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Box Model</div>
            <div className="inspector-grid">
              <div className="inspector-prop"><span>W</span>{element.boundingRect?.width?.toFixed(0)}px</div>
              <div className="inspector-prop"><span>H</span>{element.boundingRect?.height?.toFixed(0)}px</div>
            </div>
          </div>

          {!isText && !isImage && (
            <div className="inspector-section">
              <div className="inspector-section-title">Computed Styles</div>
              <div className="inspector-styles-list">
                {Object.entries(element.computedStyles || {}).map(([key, value]) => (
                  <div key={key} className="inspector-style-row">
                    <span className="inspector-style-key">{key}</span>
                    <span className="inspector-style-val">
                      {(key === 'color' || key === 'backgroundColor') && (
                        <span className="inspector-color-swatch" style={{ background: value }} />
                      )}
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {element.selector && (
            <div className="inspector-section">
              <div className="inspector-section-title">Selector</div>
              <code className="inspector-selector">{element.selector}</code>
            </div>
          )}
        </>
      )}

      {status.text && (
        <div
          className={`style-editor-msg ${status.type === 'error' ? 'error' : 'success'}`}
          style={{ margin: 12 }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}
