// Get coin UUID + test /callout/create with our JWT + UUID
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page") || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const MINT = "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
// grab jwt + coin uuid
const d = await send("Runtime.evaluate", {expression: `(async () => {
  const jwt = localStorage.getItem('decoded-jwt');
  const out = {jwt: null, coin: null};
  try { out.jwt = JSON.parse(jwt).jwt || null; } catch(e) { out.jwt = jwt; }
  // fetch coin to get its uuid
  try {
    const r = await fetch('https://frontend-api-v3.pump.fun/coins/${MINT}', {credentials: 'include'});
    const j = await r.json();
    out.coin = {id: j.id, mint: j.mint, symbol: j.symbol, userId: j.userId};
  } catch(e) { out.coinErr = e.message; }
  return out;
})()`, awaitPromise: true, returnByValue: true});
const v = d.result.value;
console.log("jwt:", v.jwt ? v.jwt.slice(0, 30) + '...len=' + v.jwt.length : null);
console.log("coin:", JSON.stringify(v.coin));
console.log("coinErr:", v.coinErr);
ws.close();
