// buy-panel-deep.mjs — deep dive into the buy panel: inputs, dialogs, overlays
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {
  expression: `(() => {
    const t = document.body ? document.body.innerText : '';
    // find the trade panel text near Buy
    const all = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent && e.textContent.trim().length < 60 && /buy|sell|sol|usd/i.test(e.textContent)).map(e => e.textContent.trim()).slice(0, 40);
    // check overlays/modals
    const modals = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="overlay"], [class*="backdrop"]')].map(m => ({cls:(m.className||'').toString().slice(0,50), txt:(m.textContent||'').slice(0,60)}));
    // inputs
    const inputs = [...document.querySelectorAll('input')].map(i => ({ph:i.placeholder||'', val:i.value, cls:(i.className||'').toString().slice(0,40)})).slice(0, 8);
    const usd = [...document.querySelectorAll('input')].filter(i => /usd|amount|sol/i.test((i.placeholder||'') + (i.id||'')));
    return JSON.stringify({ balanceLine: (t.match(/\\$[0-9.]+/)||[''])[0], buyText: all.slice(0,10), modals: modals.slice(0,5), inputs: inputs.slice(0,5), usdInputs: usd.length });
  })()`, returnByValue: true,
});
console.log("PANEL:", res?.result?.value);
ws.close();
process.exit(0);
