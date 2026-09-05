// Query the app's own holdings view for the session wallet
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
if (!page) { console.log("no page"); process.exit(0); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {expression: `(async () => {
  const out = {};
  // try the wallet-overview / positions endpoints the app uses
  for (const ep of ['/wallet-overview', '/balances', '/positions']) {
    try {
      const r = await fetch('https://frontend-api-v3.pump.fun' + ep, {credentials: 'include', method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({address: 'BT7bQZmXqk9ZedacpdWLceEeWemCU6P59zwmBC8bNUUB'})});
      out[ep] = {status: r.status, body: (await r.text()).slice(0, 300)};
    } catch(e) { out[ep] = {err: e.message}; }
  }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
