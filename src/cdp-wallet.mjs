// Check session wallet + holdings
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
if (!page) { console.log("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {expression: `(async () => {
  const out = {};
  const dj = localStorage.getItem('decoded-jwt');
  try { out.wallet = JSON.parse(dj).address; out.userId = JSON.parse(dj).userId; } catch(e) {}
  // profile endpoint for balance
  try {
    const r = await fetch('https://frontend-api-v3.pump.fun/auth/my-profile', {credentials: 'include'});
    out.profile = {status: r.status, body: (await r.text()).slice(0, 400)};
  } catch(e) { out.profileErr = e.message; }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
