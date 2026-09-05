// Test the REAL callout endpoints from authenticated page context
const MINT = process.env.PF_MINT || "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {expression: `(async () => {
  const out = [];
  // 1) eligibility check
  try {
    const r = await fetch('/callout/eligibility?mint=${MINT}', {method: 'GET', credentials: 'include'});
    out.push({ep: 'eligibility', status: r.status, body: (await r.text()).slice(0, 300)});
  } catch (e) { out.push({ep: 'eligibility', error: e.message}); }
  // 2) create
  try {
    const r = await fetch('/callout/create', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mint: '${MINT}', text: 'test callout from engine'})});
    out.push({ep: 'create', status: r.status, body: (await r.text()).slice(0, 300)});
  } catch (e) { out.push({ep: 'create', error: e.message}); }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
