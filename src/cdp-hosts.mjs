// Resolve the real API base URL from the live app + test create on it
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
  // Try to reach the module via the app's global (turbopack/webpack chunk registry)
  const out = {};
  // check known API hosts by trying a lightweight read on each
  for (const host of ['https://frontend-api-v3.pump.fun', 'https://advanced-api-v2.pump.fun', 'https://client-api.pump.fun', 'https://api.pump.fun']) {
    try {
      const r = await fetch(host + '/health', {method: 'GET', credentials: 'include'});
      out[host] = r.status + ' ' + (await r.text()).slice(0, 60);
    } catch (e) { out[host] = 'ERR ' + e.message; }
  }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
