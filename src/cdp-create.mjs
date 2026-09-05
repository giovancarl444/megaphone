// THE REAL CALL: POST /callout/create with coinMint + thesis + chainId + version
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
  // get chainId from coin
  try {
    const c = await (await fetch('https://frontend-api-v3.pump.fun/coins/${MINT}', {credentials: 'include'})).json();
    out.chainId = c.chain_id;
  } catch(e) { out.chainErr = e.message; }
  // eligibility (correct path form)
  try {
    const r = await fetch('/callout/eligibility/${MINT}', {method: 'GET', credentials: 'include'});
    out.eligibility = {status: r.status, body: (await r.text()).slice(0, 200)};
  } catch(e) { out.eligErr = e.message; }
  // CREATE — the real contract
  try {
    const r = await fetch('/callout/create', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({coinMint: '${MINT}', thesis: 'Test callout from the engine — early', chainId: out.chainId ?? 1, version: 2})});
    out.create = {status: r.status, body: (await r.text()).slice(0, 300)};
  } catch(e) { out.createErr = e.message; }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
