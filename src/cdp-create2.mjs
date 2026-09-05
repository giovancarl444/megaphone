// POST to the REAL API base: frontend-api-v3.pump.fun/callout/create with correct body
const MINT = process.env.PF_MINT || "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page") || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {expression: `(async () => {
  const out = {};
  const bases = ['https://frontend-api-v3.pump.fun', 'https://advanced-api-v2.pump.fun'];
  const body = JSON.stringify({coinMint: '${MINT}', thesis: 'Test callout from the engine — early', chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', version: 2});
  for (const base of bases) {
    try {
      const r = await fetch(base + '/callout/create', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body});
      out[base] = {status: r.status, body: (await r.text()).slice(0, 250)};
    } catch(e) { out[base] = {err: e.message}; }
  }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
