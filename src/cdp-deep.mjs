// Dump full coin object keys + all localStorage JWT candidates
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
const d = await send("Runtime.evaluate", {expression: `(async () => {
  const out = {};
  try {
    const r = await fetch('https://frontend-api-v3.pump.fun/coins/${MINT}', {credentials: 'include'});
    const j = await r.json();
    out.coinKeys = Object.keys(j).slice(0, 30);
    out.id = j.id || null; out.uuid = j.uuid || null; out.coinId = j.coinId || null; out.userId = j.userId || null;
  } catch(e) { out.coinErr = e.message; }
  // scan all localStorage for JWT-looking values
  const jwtLike = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k) || '';
    if (v.length > 100 && (v.includes('eyJ') || /jwt|token/i.test(k))) jwtLike.push({k, len: v.length, head: v.slice(0, 40)});
  }
  out.jwtLike = jwtLike.slice(0, 10);
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(d.result.value, null, 1));
ws.close();
