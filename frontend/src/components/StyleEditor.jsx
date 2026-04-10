import React, { useState, useCallback, useEffect } from 'react';
import api from '../api';

const DISPLAY_OPTIONS = ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'];
const POSITION_OPTIONS = ['static', 'relative', 'absolute', 'fixed', 'sticky'];
const TEXT_ALIGN_OPTIONS = ['left', 'center', 'right', 'justify'];
const FONT_WEIGHT_OPTIONS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];

function parsePx(val) {
  if (!val) return '';
  const n = parseFloat(val);
  return isNaN(n) ? '' : String(Math.round(n * 100) / 100);
}

function rgbToHex(rgb) {
  if (!rgb) return '#000000';
  if (rgb.startsWith('#')) return rgb;
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#000000';
  const [, r, g, b] = match;
  return '#' + [r, g, b].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

export default function StyleEditor({ selectedElement, iframeRef, project }) {
  const [styles, setStyles] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Initialize styles from selected element
  useEffect(() => {
    if (!selectedElement?.computedStyles) return;
    const cs = selectedElement.computedStyles;
    setStyles({
      color: rgbToHex(cs.color),
      backgroundColor: rgbToHex(cs.backgroundColor),
      fontSize: parsePx(cs.fontSize),
      fontWeight: cs.fontWeight || '400',
      lineHeight: parsePx(cs.lineHeight),
      textAlign: cs.textAlign || 'left',
      width: parsePx(cs.width),
      height: parsePx(cs.height),
      marginTop: parsePx(cs.marginTop),
      marginRight: parsePx(cs.marginRight),
      marginBottom: parsePx(cs.marginBottom),
      marginLeft: parsePx(cs.marginLeft),
      paddingTop: parsePx(cs.paddingTop),
      paddingRight: parsePx(cs.paddingRight),
      paddingBottom: parsePx(cs.paddingBottom),
      paddingLeft: parsePx(cs.paddingLeft),
      borderRadius: parsePx(cs.borderRadius),
      display: cs.display || 'block',
      position: cs.position || 'static',
      opacity: cs.opacity || '1',
    });
    setSaveMsg('');
  }, [selectedElement]);

  // Apply a single style change to the iframe
  const applyStyle = useCallback((prop, value) => {
    if (!iframeRef?.current || !selectedElement?.selector) return;
    try {
      const cssVal = ['fontSize', 'width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'lineHeight']
        .includes(prop) && value && !isNaN(parseFloat(value)) ? value + 'px' : value;

      iframeRef.current.contentWindow.eval(`
        (function() {
          var el = document.querySelector(${JSON.stringify(selectedElement.selector)});
          if (el) el.style.${prop} = ${JSON.stringify(cssVal)};
        })();
      `);
    } catch (err) {
      // Cross-origin fallback
      iframeRef.current.contentWindow?.postMessage({
        type: 'apply-style',
        selector: selectedElement.selector,
        prop,
        value,
      }, '*');
    }
  }, [iframeRef, selectedElement]);

  const handleChange = useCallback((prop, value) => {
    setStyles(prev => ({ ...prev, [prop]: value }));
    applyStyle(prop, value);
  }, [applyStyle]);

  // Save to CSS file
  const handleSave = useCallback(async () => {
    if (!project || !selectedElement?.selector) return;
    setSaving(true);
    setSaveMsg('');

    // Build CSS rule from changed styles
    const cssProps = [];
    const propMap = {
      color: 'color', backgroundColor: 'background-color',
      fontSize: 'font-size', fontWeight: 'font-weight', lineHeight: 'line-height',
      textAlign: 'text-align', width: 'width', height: 'height',
      marginTop: 'margin-top', marginRight: 'margin-right',
      marginBottom: 'margin-bottom', marginLeft: 'margin-left',
      paddingTop: 'padding-top', paddingRight: 'padding-right',
      paddingBottom: 'padding-bottom', paddingLeft: 'padding-left',
      borderRadius: 'border-radius', display: 'display',
      position: 'position', opacity: 'opacity',
    };

    const pxProps = ['fontSize', 'width', 'height', 'marginTop', 'marginRight', 'marginBottom',
      'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderRadius', 'lineHeight'];

    for (const [jsProp, cssProp] of Object.entries(propMap)) {
      const val = styles[jsProp];
      if (val === '' || val === undefined) continue;
      const original = selectedElement.computedStyles[jsProp];
      const currentNorm = pxProps.includes(jsProp) && val ? val + 'px' : val;
      // Only save changed values
      if (currentNorm === original || rgbToHex(original) === val) continue;
      const cssVal = pxProps.includes(jsProp) && val && !isNaN(parseFloat(val)) ? val + 'px' : val;
      cssProps.push(`  ${cssProp}: ${cssVal};`);
    }

    if (cssProps.length === 0) {
      setSaveMsg('No changes to save');
      setSaving(false);
      return;
    }

    const cssRule = `\n/* Inspector: ${selectedElement.selector} */\n${selectedElement.selector} {\n${cssProps.join('\n')}\n}\n`;

    try {
      // Find main CSS file and append
      const { data: tree } = await api.get(`/files/${encodeURIComponent(project)}`);
      const cssFile = findCssFile(tree);
      if (!cssFile) {
        setSaveMsg('No CSS file found in project');
        setSaving(false);
        return;
      }

      const { data: fileData } = await api.get(`/files/${encodeURIComponent(project)}/content`, {
        params: { path: cssFile },
      });

      await api.put(`/files/${encodeURIComponent(project)}`, {
        path: cssFile,
        content: fileData.content + cssRule,
      });

      setSaveMsg('Saved to ' + cssFile);
    } catch (err) {
      setSaveMsg('Error: ' + (err.response?.data?.error || err.message));
    }
    setSaving(false);
  }, [project, selectedElement, styles]);

  if (!selectedElement) {
    return (
      <div className="style-editor">
        <div className="style-editor-empty">
          Click an element in the preview to inspect and edit its styles.
        </div>
      </div>
    );
  }

  return (
    <div className="style-editor">
      <div className="style-editor-header">
        <span className="style-editor-title">Style Editor</span>
        <button
          className="style-editor-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save to File'}
        </button>
      </div>
      {saveMsg && <div className={`style-editor-msg ${saveMsg.startsWith('Error') ? 'error' : 'success'}`}>{saveMsg}</div>}

      {/* Colors */}
      <div className="style-editor-group">
        <div className="style-editor-group-title">Colors</div>
        <ColorInput label="Color" value={styles.color} onChange={v => handleChange('color', v)} />
        <ColorInput label="Background" value={styles.backgroundColor} onChange={v => handleChange('backgroundColor', v)} />
        <NumberInput label="Opacity" value={styles.opacity} onChange={v => handleChange('opacity', v)} step="0.1" min="0" max="1" suffix="" />
      </div>

      {/* Typography */}
      <div className="style-editor-group">
        <div className="style-editor-group-title">Typography</div>
        <NumberInput label="Font Size" value={styles.fontSize} onChange={v => handleChange('fontSize', v)} suffix="px" />
        <DropdownInput label="Font Weight" value={styles.fontWeight} options={FONT_WEIGHT_OPTIONS} onChange={v => handleChange('fontWeight', v)} />
        <NumberInput label="Line Height" value={styles.lineHeight} onChange={v => handleChange('lineHeight', v)} suffix="px" />
        <DropdownInput label="Text Align" value={styles.textAlign} options={TEXT_ALIGN_OPTIONS} onChange={v => handleChange('textAlign', v)} />
      </div>

      {/* Layout */}
      <div className="style-editor-group">
        <div className="style-editor-group-title">Layout</div>
        <DropdownInput label="Display" value={styles.display} options={DISPLAY_OPTIONS} onChange={v => handleChange('display', v)} />
        <DropdownInput label="Position" value={styles.position} options={POSITION_OPTIONS} onChange={v => handleChange('position', v)} />
        <NumberInput label="Width" value={styles.width} onChange={v => handleChange('width', v)} suffix="px" />
        <NumberInput label="Height" value={styles.height} onChange={v => handleChange('height', v)} suffix="px" />
      </div>

      {/* Spacing */}
      <div className="style-editor-group">
        <div className="style-editor-group-title">Margin</div>
        <div className="style-editor-row-4">
          <NumberInput label="T" value={styles.marginTop} onChange={v => handleChange('marginTop', v)} suffix="px" compact />
          <NumberInput label="R" value={styles.marginRight} onChange={v => handleChange('marginRight', v)} suffix="px" compact />
          <NumberInput label="B" value={styles.marginBottom} onChange={v => handleChange('marginBottom', v)} suffix="px" compact />
          <NumberInput label="L" value={styles.marginLeft} onChange={v => handleChange('marginLeft', v)} suffix="px" compact />
        </div>
      </div>

      <div className="style-editor-group">
        <div className="style-editor-group-title">Padding</div>
        <div className="style-editor-row-4">
          <NumberInput label="T" value={styles.paddingTop} onChange={v => handleChange('paddingTop', v)} suffix="px" compact />
          <NumberInput label="R" value={styles.paddingRight} onChange={v => handleChange('paddingRight', v)} suffix="px" compact />
          <NumberInput label="B" value={styles.paddingBottom} onChange={v => handleChange('paddingBottom', v)} suffix="px" compact />
          <NumberInput label="L" value={styles.paddingLeft} onChange={v => handleChange('paddingLeft', v)} suffix="px" compact />
        </div>
      </div>

      <div className="style-editor-group">
        <div className="style-editor-group-title">Border</div>
        <NumberInput label="Radius" value={styles.borderRadius} onChange={v => handleChange('borderRadius', v)} suffix="px" />
      </div>
    </div>
  );
}

// Sub-components

function ColorInput({ label, value, onChange }) {
  return (
    <div className="style-editor-field">
      <label>{label}</label>
      <div className="style-editor-color-wrap">
        <input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)} />
        <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} spellCheck={false} />
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, suffix = 'px', step = '1', min, max, compact }) {
  return (
    <div className={`style-editor-field ${compact ? 'compact' : ''}`}>
      <label>{label}</label>
      <div className="style-editor-number-wrap">
        <input
          type="number"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          step={step}
          min={min}
          max={max}
        />
        {suffix && <span className="style-editor-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

function DropdownInput({ label, value, options, onChange }) {
  return (
    <div className="style-editor-field">
      <label>{label}</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// Find the main CSS file in a project tree
function findCssFile(tree, depth = 0) {
  if (!Array.isArray(tree)) return null;
  // Priority: styles.css, style.css, main.css, index.css, App.css, any .css
  const priorities = ['styles.css', 'style.css', 'main.css', 'index.css', 'app.css'];
  for (const node of tree) {
    if (node.type === 'file') {
      const name = node.name.toLowerCase();
      if (priorities.includes(name)) return node.path;
    }
  }
  // Check children
  for (const node of tree) {
    if (node.children) {
      const found = findCssFile(node.children, depth + 1);
      if (found) return found;
    }
  }
  // Fallback: any .css file
  for (const node of tree) {
    if (node.type === 'file' && node.name.endsWith('.css')) return node.path;
  }
  return null;
}
