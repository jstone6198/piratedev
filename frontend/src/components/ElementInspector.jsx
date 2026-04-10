import React, { useState, useEffect, useCallback } from 'react';

const INSPECT_SCRIPT = `
(function() {
  if (window.__inspectorActive) return;
  window.__inspectorActive = true;

  let overlay = document.createElement('div');
  overlay.id = '__inspector-overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #007acc;background:rgba(0,122,204,0.08);z-index:99999;transition:all 0.05s;display:none;';
  document.body.appendChild(overlay);

  let label = document.createElement('div');
  label.id = '__inspector-label';
  label.style.cssText = 'position:fixed;z-index:100000;background:#007acc;color:#fff;font:11px/1.4 monospace;padding:2px 6px;border-radius:2px;pointer-events:none;display:none;white-space:nowrap;';
  document.body.appendChild(label);

  function getSelector(el) {
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    let s = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).join('.');
    return s;
  }

  window.__inspectorMouseOver = function(e) {
    let el = e.target;
    if (el.id === '__inspector-overlay' || el.id === '__inspector-label') return;
    let rect = el.getBoundingClientRect();
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
    e.preventDefault();
    e.stopPropagation();
    let el = e.target;
    if (el.id === '__inspector-overlay' || el.id === '__inspector-label') return;
    let rect = el.getBoundingClientRect();
    let cs = window.getComputedStyle(el);
    window.parent.postMessage({
      type: 'element-selected',
      data: {
        tagName: el.tagName.toLowerCase(),
        className: el.className || '',
        id: el.id || '',
        textContent: (el.textContent || '').substring(0, 100),
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
          opacity: cs.opacity,
        },
        boundingRect: {
          top: rect.top, left: rect.left,
          width: rect.width, height: rect.height,
        },
        selector: buildUniqueSelector(el),
      }
    }, '*');
  };

  function buildUniqueSelector(el) {
    if (el.id) return '#' + el.id;
    let path = [];
    while (el && el !== document.body && el !== document.documentElement) {
      let s = el.tagName.toLowerCase();
      if (el.id) { path.unshift('#' + el.id); break; }
      if (el.className && typeof el.className === 'string') {
        s += '.' + el.className.trim().split(/\\s+/).join('.');
      }
      let parent = el.parentElement;
      if (parent) {
        let siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) {
          s += ':nth-child(' + (Array.from(parent.children).indexOf(el) + 1) + ')';
        }
      }
      path.unshift(s);
      el = parent;
    }
    return path.join(' > ');
  }

  document.addEventListener('mouseover', window.__inspectorMouseOver, true);
  document.addEventListener('click', window.__inspectorClick, true);
})();
`;

const DISABLE_SCRIPT = `
(function() {
  window.__inspectorActive = false;
  let ov = document.getElementById('__inspector-overlay');
  let lb = document.getElementById('__inspector-label');
  if (ov) ov.remove();
  if (lb) lb.remove();
  if (window.__inspectorMouseOver) document.removeEventListener('mouseover', window.__inspectorMouseOver, true);
  if (window.__inspectorClick) document.removeEventListener('click', window.__inspectorClick, true);
  window.__inspectorMouseOver = null;
  window.__inspectorClick = null;
})();
`;

export default function ElementInspector({ active, iframeRef, selectedElement, onSelectElement }) {
  // Listen for postMessage from iframe
  useEffect(() => {
    const handler = (e) => {
      if (e.data && e.data.type === 'element-selected') {
        onSelectElement(e.data.data);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onSelectElement]);

  // Inject/remove inspector script when active changes
  useEffect(() => {
    const iframe = iframeRef?.current;
    if (!iframe) return;
    try {
      const iframeWin = iframe.contentWindow;
      if (!iframeWin) return;
      if (active) {
        iframeWin.eval(INSPECT_SCRIPT);
      } else {
        iframeWin.eval(DISABLE_SCRIPT);
      }
    } catch (err) {
      // Cross-origin: fall back to postMessage approach
      if (active) {
        iframe.contentWindow?.postMessage({ type: 'enable-inspector', script: INSPECT_SCRIPT }, '*');
      } else {
        iframe.contentWindow?.postMessage({ type: 'disable-inspector', script: DISABLE_SCRIPT }, '*');
      }
    }
  }, [active, iframeRef]);

  if (!selectedElement) return null;

  const el = selectedElement;
  const selectorDisplay = el.id ? `#${el.id}` : el.className
    ? `${el.tagName}.${typeof el.className === 'string' ? el.className.trim().split(/\s+/).join('.') : ''}`
    : el.tagName;

  return (
    <div className="element-inspector">
      <div className="inspector-header">
        <span className="inspector-icon">&#x25CE;</span>
        <span className="inspector-title">Element Inspector</span>
      </div>

      <div className="inspector-section">
        <div className="inspector-tag">&lt;{el.tagName}&gt;</div>
        {el.id && <div className="inspector-detail"><span className="inspector-label">id</span> {el.id}</div>}
        {el.className && <div className="inspector-detail"><span className="inspector-label">class</span> {typeof el.className === 'string' ? el.className : ''}</div>}
        {el.textContent && (
          <div className="inspector-detail">
            <span className="inspector-label">text</span>
            <span className="inspector-text-preview">{el.textContent}</span>
          </div>
        )}
      </div>

      <div className="inspector-section">
        <div className="inspector-section-title">Box Model</div>
        <div className="inspector-grid">
          <div className="inspector-prop"><span>W</span>{el.boundingRect?.width?.toFixed(0)}px</div>
          <div className="inspector-prop"><span>H</span>{el.boundingRect?.height?.toFixed(0)}px</div>
        </div>
      </div>

      <div className="inspector-section">
        <div className="inspector-section-title">Computed Styles</div>
        <div className="inspector-styles-list">
          {Object.entries(el.computedStyles || {}).map(([key, val]) => (
            <div key={key} className="inspector-style-row">
              <span className="inspector-style-key">{key}</span>
              <span className="inspector-style-val">
                {(key === 'color' || key === 'backgroundColor') && (
                  <span className="inspector-color-swatch" style={{ background: val }} />
                )}
                {val}
              </span>
            </div>
          ))}
        </div>
      </div>

      {el.selector && (
        <div className="inspector-section">
          <div className="inspector-section-title">Selector</div>
          <code className="inspector-selector">{el.selector}</code>
        </div>
      )}
    </div>
  );
}
