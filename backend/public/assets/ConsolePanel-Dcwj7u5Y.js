import{r as a,j as o}from"./vendor-D7f9BLy3.js";const n={background:"#1e1e1e",panel:"#252526",border:"rgba(255, 255, 255, 0.08)",text:"#d4d4d4",muted:"#808080",accent:"#3a3d41",log:"#999999",warn:"#e5c07b",error:"#e06c75"},E=["all","log","warn","error"],x=500,w="console-panel-bridge",j=`
(() => {
  if (window.__consolePanelBridgeInstalled) return;
  window.__consolePanelBridgeInstalled = true;

  const levels = ['log', 'warn', 'error'];
  const originalConsole = {};

  const serialize = (value, seen = new WeakSet()) => {
    if (value === null) return null;
    if (value === undefined) return undefined;

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return value.toString() + 'n';
    if (type === 'function') return '[Function ' + (value.name || 'anonymous') + ']';

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack || '',
      };
    }

    if (type !== 'object') {
      try {
        return String(value);
      } catch (error) {
        return '[Unserializable]';
      }
    }

    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => serialize(item, seen));
    }

    if (typeof Node !== 'undefined' && value instanceof Node) {
      return '<' + String(value.nodeName || 'node').toLowerCase() + '>';
    }

    if (typeof Window !== 'undefined' && value instanceof Window) {
      return '[Window]';
    }

    const result = {};
    for (const key of Object.keys(value).slice(0, 50)) {
      try {
        result[key] = serialize(value[key], seen);
      } catch (error) {
        result[key] = '[Unreadable]';
      }
    }
    return result;
  };

  const postEntry = (level, args) => {
    try {
      window.parent.postMessage(
        {
          source: '${w}',
          type: 'console-entry',
          payload: {
            level,
            args: Array.from(args || []).map((arg) => serialize(arg)),
            timestamp: Date.now(),
          },
        },
        '*'
      );
    } catch (error) {}
  };

  for (const level of levels) {
    if (typeof console[level] !== 'function') continue;
    originalConsole[level] = console[level];
    console[level] = (...args) => {
      postEntry(level, args);
      return originalConsole[level].apply(console, args);
    };
  }
})();
`;function k(e){if(e===null)return"null";if(e===void 0)return"undefined";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean"||typeof e=="bigint")return String(e);if(typeof e=="object"&&e&&"name"in e&&"message"in e&&Object.keys(e).every(i=>["name","message","stack"].includes(i)))return[e.name,e.message].filter(Boolean).join(": ");try{return JSON.stringify(e,null,2)}catch{return String(e)}}function C(e){return(e.args||[]).map(k).join(" ")}function v(e){return{border:`1px solid ${e?"#5a5d61":n.border}`,background:e?n.accent:n.background,color:e?"#ffffff":n.text,borderRadius:6,padding:"6px 10px",fontSize:12,lineHeight:1,cursor:"pointer"}}function L({project:e}){const[i,p]=a.useState([]),[g,h]=a.useState("all"),l=a.useRef(null);a.useEffect(()=>{p([])},[e]),a.useEffect(()=>{const r=t=>{const s={id:`${t.timestamp||Date.now()}-${Math.random().toString(36).slice(2,9)}`,level:["log","warn","error"].includes(t.level)?t.level:"log",args:Array.isArray(t.args)?t.args:[],timestamp:t.timestamp||Date.now()};p(d=>{const f=[...d,s];return f.length>x?f.slice(f.length-x):f})},c=t=>{var s,d;((s=t==null?void 0:t.data)==null?void 0:s.source)!==w||t.data.type!=="console-entry"||(d=l.current)!=null&&d.contentWindow&&t.source!==l.current.contentWindow||r(t.data.payload||{})},u=()=>{const t=document.querySelector(".preview-iframe");if(l.current=t||null,!!(t!=null&&t.contentWindow))try{t.contentWindow.eval(j)}catch{}},y=()=>{const t=document.querySelector(".preview-iframe");t&&(l.current&&l.current!==t&&l.current.removeEventListener("load",u),l.current=t,t.addEventListener("load",u),u())},b=new MutationObserver(y);return b.observe(document.body,{childList:!0,subtree:!0}),y(),window.addEventListener("message",c),()=>{b.disconnect(),window.removeEventListener("message",c),l.current&&l.current.removeEventListener("load",u)}},[]);const m=g==="all"?i:i.filter(r=>r.level===g),S={log:i.filter(r=>r.level==="log").length,warn:i.filter(r=>r.level==="warn").length,error:i.filter(r=>r.level==="error").length};return o.jsxs("div",{style:{display:"flex",flexDirection:"column",height:"100%",minHeight:0,background:n.background,color:n.text,fontFamily:"'JetBrains Mono', 'Fira Code', monospace"},children:[o.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"10px 12px",background:n.panel,borderBottom:`1px solid ${n.border}`},children:[o.jsx("div",{style:{fontSize:12,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"},children:"Console"}),E.map(r=>{const c=r==="all"?`All (${i.length})`:`${r} (${S[r]})`;return o.jsx("button",{type:"button",onClick:()=>h(r),style:v(g===r),children:c},r)}),o.jsx("div",{style:{flex:1}}),o.jsx("button",{type:"button",onClick:()=>p([]),style:v(!1),children:"Clear"})]}),o.jsx("div",{style:{flex:1,minHeight:0,overflow:"auto"},children:m.length===0?o.jsx("div",{style:{padding:"16px 12px",color:n.muted,fontSize:12,lineHeight:1.5},children:e?"No preview console output yet.":"Select a project to capture preview console output."}):m.map(r=>o.jsxs("div",{style:{padding:"10px 12px",borderBottom:`1px solid ${n.border}`,color:n[r.level],fontSize:12,lineHeight:1.5},children:[o.jsxs("div",{style:{display:"flex",alignItems:"baseline",gap:10,marginBottom:4,color:n.muted},children:[o.jsx("span",{children:new Date(r.timestamp).toLocaleTimeString()}),o.jsx("span",{style:{color:n[r.level],textTransform:"uppercase"},children:r.level})]}),o.jsx("pre",{style:{margin:0,color:n[r.level],whiteSpace:"pre-wrap",wordBreak:"break-word",fontFamily:"inherit"},children:C(r)})]},r.id))})]})}export{L as default};
