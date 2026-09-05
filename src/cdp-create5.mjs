// Try callout on a HIGH-VOLUME live coin (price definitely available)
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
  // use the coins we SAW on the home feed (XCAT $257K etc) — try a few known-active mints
  const candidates = ['6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump'];
  // fetch currently-live coins (has price by definition)
  try {
    const f = await (await fetch('https://frontend-api-v3.pump.fun/coins/currently/live?limit=3', {credentials: 'include'})).json();
    const lst = Array.isArray(f) ? f : (f.list || []);
    out.live = lst.map(c => ({mint: c.mint, symbol: c.symbol, mc: c.usd_market_cap, vol: c.volume_24h}));
  } catch(e) { out.liveErr = e.message; }
  // try create on the first live coin
  try {
    const f = await (await fetch('https://frontend-api-v3.pump.fun/coins/currently/live?limit=1', {credentials: 'include'})).json();
    const coin = (Array.isArray(f) ? f : (f.list || []))[0];
    if (coin) {
      const body = JSON.stringify({coinMint: coin.mint, thesis: 'Test callout from the engine — live coin', chainId: 1, version: 2});
      const r = await fetch('https://frontend-api-v3.pump.fun/callout/create', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body});
      out.create = {mint: coin.mint, status: r.status, body: (await r.text()).slice(0, 400)};
    }
  } catch(e) { out.createErr = e.message; }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
