// privy-frame.mjs — inspect the Privy embedded-wallet iframe state
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

// Try accessing privy iframe content (cross-origin may block, but try)
console.log("privy frame:", await ev(`(() => {
  const f = [...document.querySelectorAll('iframe')].find(x => (x.src||'').includes('privy'));
  if (!f) return 'no-frame';
  let inner = 'blocked';
  try { inner = f.contentDocument ? (f.contentDocument.body ? f.contentDocument.body.innerText.slice(0, 300) : 'empty-body') : 'no-doc'; } catch(e) { inner = 'cross-origin: ' + e.message.slice(0, 60); }
  return JSON.stringify({src: f.src.slice(0, 100), w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height, style: (f.getAttribute('style')||'').slice(0,150), inner});
})()`));

// Check localStorage privy state
console.log("privy LS:", await ev(`(() => {
  const out = {};
  for (const k of Object.keys(localStorage)) if (k.includes('privy')) out[k] = (localStorage.getItem(k)||'').slice(0, 50);
  return JSON.stringify(out);
})()`));
ws.close();
process.exit(0);
