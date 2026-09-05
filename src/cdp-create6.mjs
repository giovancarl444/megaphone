// Resolve the REAL getClientServerUrl from the live app module registry + call create exactly as the app does
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
  // hunt the module: turbopack registry holds it; try common global paths
  const globals = [globalThis.__turbopack__, globalThis.TURBOPACK, globalThis.__webpack_require__];
  out.hasGlobals = globals.map(g => !!g);
  // simpler: fetch a fresh coin then try create via relative path with full header set (Origin explicitly)
  const f = await (await fetch('https://frontend-api-v3.pump.fun/coins?sort=created_timestamp&limit=1', {credentials: 'include'})).json();
  const coin = f[0];
  out.coin = coin ? {mint: coin.mint, symbol: coin.symbol} : null;
  if (coin) {
    // exact app call shape, Origin header added
    const body = JSON.stringify({coinMint: coin.mint, thesis: 'Test callout from the engine — early', version: 2});
    const r = await fetch('https://frontend-api-v3.pump.fun/callout/create', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json', 'Origin': 'https://pump.fun'}, body});
    out.create = {status: r.status, body: (await r.text()).slice(0, 400)};
  }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
