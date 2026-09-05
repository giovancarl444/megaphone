// denom-check.mjs — find the USD/SOL denomination toggle near the amount input
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
console.log("denom:", await ev(`(() => {
  const t = document.body.innerText;
  // find buttons that say USD or SOL (toggle chips)
  const chips = [...document.querySelectorAll('button')].filter(b => {
    const txt = (b.textContent||'').trim();
    const r = b.getBoundingClientRect();
    return (txt === 'USD' || txt === 'SOL') && r.width > 0 && r.height > 0 && r.width < 80;
  }).map(b => ({t:(b.textContent||'').trim(), x:Math.round(b.getBoundingClientRect().x), y:Math.round(b.getBoundingClientRect().y)}));
  // find text near the input
  const amtLabel = t.match(/Amount\\s*\\(([A-Z]+)\\)/);
  return JSON.stringify({ chips, amtLabel: amtLabel ? amtLabel[1] : null });
})()`));
ws.close();
process.exit(0);
