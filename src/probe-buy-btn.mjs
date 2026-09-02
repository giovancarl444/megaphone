// probe-buy-btn.mjs — locate the ACTUAL buy button in the trade panel (has Buy text + is a real CTA)
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
  const out = {buyButtons: [], tabs: [], quickAmts: []};
  [...document.querySelectorAll('button')].forEach((b, idx) => {
    const t = (b.textContent||'').trim().replace(/\\s+/g,' ');
    if (t === 'Buy' || t === 'Sell') {
      const r = b.getBoundingClientRect();
      const cls = (b.className||'').toString();
      out.tabs.push({idx, t, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cls: cls.slice(0,80)});
    }
    // big CTA buttons (gradient / large height)
    if (r0 = b.getBoundingClientRect(), r0.height > 40 && (t.includes('Buy') || t.includes('Sell') || /^\\$/.test(t))) {
      out.buyButtons.push({idx, t: t.slice(0,30), x: Math.round(r0.x), y: Math.round(r0.y), w: Math.round(r0.width), h: Math.round(r0.height), cls: (b.className||'').toString().slice(0,90)});
    }
  });
  // quick amount chips ($5/$10/$25 etc)
  [...document.querySelectorAll('button,span,div')].forEach(e => {
    if (e.children.length === 0) {
      const t = (e.textContent||'').trim();
      if (/^\\$(1|2|5|10|25|50|100)$/.test(t)) out.quickAmts.push(t);
    }
  });
  return JSON.stringify(out);
})()`, returnByValue: true });
console.log(JSON.stringify(res?.result?.value, null, 1)?.slice(0, 2000));
ws.close();
