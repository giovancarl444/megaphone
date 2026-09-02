// probe-cta.mjs — find the real buy CTA className + what dialogs are open
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", { expression: `(() => {
  const out = {buttons: [], dialogs: []};
  [...document.querySelectorAll('button')].forEach((b, i) => {
    const t = (b.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30);
    const cls = (b.className||'').toString();
    const r = b.getBoundingClientRect();
    if (r.width > 0 && (t.toLowerCase().includes('buy') || t.toLowerCase().includes('sell') || cls.includes('1FD978') || cls.includes('h-10'))) {
      out.buttons.push({i, t, w: Math.round(r.width), h: Math.round(r.height), cls: cls.slice(0,120)});
    }
  });
  // any modal/dialog open?
  [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"]')].forEach(d => {
    out.dialogs.push({cls: (d.className||'').toString().slice(0,80), text: (d.innerText||'').slice(0,120).replace(/\\n+/g,' | ')});
  });
  return JSON.stringify(out);
})()`, returnByValue: true });
console.log(JSON.stringify(res?.result?.value, null, 1)?.slice(0, 2500));
ws.close();
