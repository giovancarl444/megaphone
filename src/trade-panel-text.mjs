// trade-panel-text.mjs — dump ALL text around the trade panel (buttons, labels, chips)
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
console.log(await ev(`(() => {
  // find all clickable elements with short text in the right-side panel area (x > 700)
  const out = [...document.querySelectorAll('button, [role="tab"], [role="radio"], [role="switch"], label, a')]
    .map(el => { const r = el.getBoundingClientRect(); const txt = (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40);
      return { t: txt, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName };
    })
    .filter(o => o.x > 650 && o.w > 0 && o.h > 0 && o.t.length > 0 && o.t.length < 40)
    .sort((a,b) => a.y - b.y || a.x - b.x);
  return JSON.stringify(out.slice(0, 40));
})()`));
ws.close();
process.exit(0);
