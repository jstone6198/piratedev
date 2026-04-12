import{r as u,j as t}from"./vendor-D7f9BLy3.js";import{a as E}from"./index-TTgq067F.js";import"./ui-B7tiAixk.js";import"./monaco-f9AgBWEQ.js";import"./xterm-CO2CZP_-.js";const W=/\.(?:[cm]?[jt]sx?|html?|css|scss|sass|less|mdx?|json|vue|svelte)$/i,F=`
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
`,q=`
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
`;function Q(l){return l.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function K(l){const n=(l||"").replace(/\\/g,"/"),i=n.startsWith("/"),c=n.split("/"),r=[];for(const d of c)if(!(!d||d===".")){if(d===".."){r.length&&r[r.length-1]!==".."?r.pop():i||r.push("..");continue}r.push(d)}return`${i?"/":""}${r.join("/")}`||(i?"/":".")}function I(...l){const n=l.filter(Boolean);return n.length===0?".":K(n.join("/"))}function A(l){const n=K(l);if(n==="."||n==="/")return n;const i=n.lastIndexOf("/");return i===-1?".":i===0?"/":n.slice(0,i)}function N(l){return[...new Set(l.filter(Boolean))]}function z(...l){const n=[];for(const i of l){if(!i||typeof i!="string")continue;const c=i.trim();c&&n.push(c);const r=i.split(`
`).map(p=>p.trim()).filter(Boolean).sort((p,d)=>d.length-p.length);r[0]&&n.push(r[0])}return N(n)}function X(l){return N(l.map(n=>n.file)).sort((n,i)=>{const c=W.test(n)?0:1,r=W.test(i)?0:1;return c!==r?c-r:n.localeCompare(i)})}async function G(l,n,i){var r;let c=[];for(const p of N(n)){if(!p)continue;const d=await E.get(`/search/${encodeURIComponent(l)}`,{params:{q:Q(p)}});if(Array.isArray(d.data)&&d.data.length>0){c=d.data;break}}if(c.length===0)return null;for(const p of X(c)){const g=((r=(await E.get(`/files/${encodeURIComponent(l)}/content`,{params:{path:p}})).data)==null?void 0:r.content)??"";for(const m of N(i)){if(!m)continue;const b=g.indexOf(m);if(b!==-1)return{file:p,content:g,needle:m,index:b}}}return null}function H(l,n,i){const c=l.indexOf(n);return c===-1?null:`${l.slice(0,c)}${i}${l.slice(c+n.length)}`}function J(l){return/^(?:https?:)?\/\//i.test(l)||/^(?:data|blob):/i.test(l)}function Y(l,n,i){const c=(i||"image").replace(/\s+/g,"-");if(J(n))return{uploadDir:"public/uploads",replacementRef:`/uploads/${c}`};if(n.startsWith("/")){const m=A(n.slice(1));return{uploadDir:m==="."?"public":I("public",m),replacementRef:`/${m==="."?c:`${m}/${c}`}`}}const r=A(n),p=A(l),d=r==="."?p:I(p,r),g=r==="."?c:I(r,c);return{uploadDir:d==="."?"":d,replacementRef:n.startsWith("./")&&!g.startsWith(".")?`./${g}`:g}}function ie({active:l,iframeRef:n,project:i,selectedElement:c,onSelectElement:r}){var L,O,B,M;const[p,d]=u.useState({type:"",text:""}),[g,m]=u.useState(!1),b=u.useRef(null),_=u.useRef(null),y=u.useCallback(()=>{var o;const e=n==null?void 0:n.current;if(e)try{const a=e.contentWindow;if(!a)return;a.eval(l?F:q)}catch{(o=e.contentWindow)==null||o.postMessage({type:l?"enable-inspector":"disable-inspector",script:l?F:q},"*")}},[l,n]),T=u.useCallback((e,o)=>{var a;if(!(!e||!((a=n==null?void 0:n.current)!=null&&a.contentWindow)||typeof o!="function"))try{o(n.current.contentWindow.document.querySelector(e))}catch{}},[n]),S=u.useCallback(async(e,o,a=[])=>{if(!i)throw new Error("No project selected");const f=await G(i,z(e,...a),[e,...a]);if(!f)throw new Error("Could not find the selected content in project files");const x=H(f.content,f.needle,o);if(x==null)throw new Error("Exact match disappeared before save");return await E.put(`/files/${encodeURIComponent(i)}`,{path:f.file,content:x}),f.file},[i]),$=u.useCallback(async e=>{var a,f;if(!(e!=null&&e.oldText)||e.newText==null)return;const o={...e,textContent:e.newText,sourceText:e.newText,elementType:"text"};r(o),m(!0),d({type:"",text:""});try{const x=await S(e.oldText,e.newText,[e.sourceText]);T(e.selector,w=>{w&&(w.textContent=e.newText)}),d({type:"success",text:`Saved text change in ${x}`})}catch(x){d({type:"error",text:((f=(a=x.response)==null?void 0:a.data)==null?void 0:f.error)||x.message}),T(e.selector,w=>{w&&(w.textContent=e.oldText)}),r({...e,textContent:e.oldText,sourceText:e.oldText,elementType:"text"}),y()}finally{m(!1)}},[S,y,r,T]),C=u.useCallback(e=>{_.current=e,r(e),d({type:"",text:""}),requestAnimationFrame(()=>{var o;(o=b.current)==null||o.click()})},[r]),V=u.useCallback(async e=>{var f,x,w;const o=(f=e.target.files)==null?void 0:f[0],a=_.current;if(e.target.value="",!(!o||!(a!=null&&a.sourceAttribute))){if(!i){d({type:"error",text:"No project selected"});return}m(!0),d({type:"",text:""});try{const h=await G(i,z(a.sourceAttribute,a.src),[a.sourceAttribute,a.src]);if(!h)throw new Error("Could not find the image source in project files");const v=Y(h.file,a.sourceAttribute,o.name),P=new FormData;P.append("files",o),await E.post(`/files/${encodeURIComponent(i)}/upload${v.uploadDir?`?path=${encodeURIComponent(v.uploadDir)}`:""}`,P,{headers:{"Content-Type":"multipart/form-data"}});const U=H(h.content,h.needle,v.replacementRef);if(U==null)throw new Error("Exact image source disappeared before save");await E.put(`/files/${encodeURIComponent(i)}`,{path:h.file,content:U}),r({...a,src:v.replacementRef,sourceAttribute:v.replacementRef,elementType:"image"}),T(a.selector,k=>{k&&k.tagName==="IMG"&&k.setAttribute("src",v.replacementRef)}),d({type:"success",text:`Uploaded image and updated ${h.file}`})}catch(h){d({type:"error",text:((w=(x=h.response)==null?void 0:x.data)==null?void 0:w.error)||h.message})}finally{m(!1),_.current=null}}},[r,i,T]);u.useEffect(()=>{const e=o=>{var a;(a=o.data)!=null&&a.type&&(o.data.type==="element-selected"&&r(o.data.data),o.data.type==="text-edit-commit"&&$(o.data.data),o.data.type==="image-edit-request"&&C(o.data.data))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[C,$,r]),u.useEffect(()=>{y();const e=n==null?void 0:n.current;if(e)return e.addEventListener("load",y),()=>e.removeEventListener("load",y)},[n,y]),u.useEffect(()=>{c||d(e=>e.type==="error"?e:{type:"",text:""})},[c]);const s=c,D=u.useMemo(()=>{if(!s)return"";if(s.id)return`#${s.id}`;if(s.className){const e=typeof s.className=="string"?s.className.trim().split(/\s+/).join("."):"";return`${s.tagName}.${e}`}return s.tagName},[s]),j=(s==null?void 0:s.elementType)==="text",R=(s==null?void 0:s.elementType)==="image";return t.jsxs("div",{className:"element-inspector",style:{background:"#1e1e1e",color:"#d4d4d4"},children:[t.jsx("input",{ref:b,type:"file",accept:"image/*",style:{display:"none"},onChange:V}),t.jsxs("div",{className:"inspector-header",children:[t.jsx("span",{className:"inspector-icon",children:"◎"}),t.jsx("span",{className:"inspector-title",children:"Element Inspector"})]}),!s&&t.jsx("div",{className:"inspector-section",children:t.jsx("div",{className:"inspector-detail",children:"Click text to edit inline, click an image to replace it, or click any other element to inspect styles."})}),s&&t.jsxs(t.Fragment,{children:[t.jsxs("div",{className:"inspector-section",children:[t.jsxs("div",{className:"inspector-tag",children:["<",s.tagName,">"]}),t.jsxs("div",{className:"inspector-detail",children:[t.jsx("span",{className:"inspector-label",children:"type"})," ",s.elementType||"other"]}),s.id&&t.jsxs("div",{className:"inspector-detail",children:[t.jsx("span",{className:"inspector-label",children:"id"})," ",s.id]}),s.className&&t.jsxs("div",{className:"inspector-detail",children:[t.jsx("span",{className:"inspector-label",children:"class"})," ",typeof s.className=="string"?s.className:""]}),D&&t.jsxs("div",{className:"inspector-detail",children:[t.jsx("span",{className:"inspector-label",children:"target"})," ",D]}),j&&t.jsxs("div",{className:"inspector-detail",children:[t.jsx("span",{className:"inspector-label",children:"text"}),t.jsx("span",{className:"inspector-text-preview",children:s.textContent})]}),R&&t.jsxs(t.Fragment,{children:[t.jsxs("div",{className:"inspector-detail",children:[t.jsx("span",{className:"inspector-label",children:"src"}),t.jsx("span",{className:"inspector-text-preview",children:s.sourceAttribute||s.src})]}),t.jsx("button",{type:"button",className:"style-editor-save-btn",onClick:()=>C(s),disabled:g,children:g?"Working...":"Replace Image"})]}),j&&t.jsx("div",{className:"inspector-detail",children:"Edit the text directly in the preview. Press `Enter` or click away to save."})]}),t.jsxs("div",{className:"inspector-section",children:[t.jsx("div",{className:"inspector-section-title",children:"Box Model"}),t.jsxs("div",{className:"inspector-grid",children:[t.jsxs("div",{className:"inspector-prop",children:[t.jsx("span",{children:"W"}),(O=(L=s.boundingRect)==null?void 0:L.width)==null?void 0:O.toFixed(0),"px"]}),t.jsxs("div",{className:"inspector-prop",children:[t.jsx("span",{children:"H"}),(M=(B=s.boundingRect)==null?void 0:B.height)==null?void 0:M.toFixed(0),"px"]})]})]}),!j&&!R&&t.jsxs("div",{className:"inspector-section",children:[t.jsx("div",{className:"inspector-section-title",children:"Computed Styles"}),t.jsx("div",{className:"inspector-styles-list",children:Object.entries(s.computedStyles||{}).map(([e,o])=>t.jsxs("div",{className:"inspector-style-row",children:[t.jsx("span",{className:"inspector-style-key",children:e}),t.jsxs("span",{className:"inspector-style-val",children:[(e==="color"||e==="backgroundColor")&&t.jsx("span",{className:"inspector-color-swatch",style:{background:o}}),o]})]},e))})]}),s.selector&&t.jsxs("div",{className:"inspector-section",children:[t.jsx("div",{className:"inspector-section-title",children:"Selector"}),t.jsx("code",{className:"inspector-selector",children:s.selector})]})]}),p.text&&t.jsx("div",{className:`style-editor-msg ${p.type==="error"?"error":"success"}`,style:{margin:12},children:p.text})]})}export{ie as default};
