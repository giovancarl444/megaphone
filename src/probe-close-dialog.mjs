// probe-close-dialog.mjs — inspect the deposit dialog's close button
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", { expression: `(() => {
  const out = {closeBtns: [], dialogBtns: []};
  const dlg = document.querySelector('[role="dialog"], [class*="dialog_responsive"]');
  if (dlg) {
    out.dialogCls = (dlg.className||'').toString().slice(0,80);
    [...dlg.querySelectorAll('button')].forEach((b) => {
      const t = (b.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30);
      const cls = (b.className||'').toString();
      const r = b.getBoundingClientRect();
      out.dialogBtns.push({t, w: Math.round(r.width), h: Math.round(r.height), cls: cls.slice(0,80)});
    });
  }
  // also check for X/close icon buttons anywhere visible
  [...document.querySelectorAll('button')].forEach((b) => {
    const cls = (b.className||'').toString();
    const r = b.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (cls.includes('close') || cls.includes('Close') || b.getAttribute('aria-label') === 'Close' || (b.textContent||'').trim() === '×' || (b.textContent||'').trim() === '✕')) {
      out.closeBtns.push({cls: cls.slice(0,90), aria: b.getAttribute('aria-label')||'', t: (b.textContent||'').trim().slice(0,10), x: Math.round(r.x), y: Math.round(r.y)});
    }
  });
  return JSON.stringify(out);
})()`, returnByValue: true });
console.log(JSON.stringify(res?.result?.value, null, 1)?.slice(0, 2000));
ws.close();
