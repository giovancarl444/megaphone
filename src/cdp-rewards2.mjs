// Callout list on the correct host (frontend-api-v3) with frontend params
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
  const userId = '4ac11d85-afce-47cb-9c81-8345400351b4';
  const tries = [
    ['frontend list', 'https://frontend-api-v3.pump.fun/callout/list/' + userId + '?limit=10&sortBy=createdAt&sortOrder=desc'],
    ['frontend top', 'https://frontend-api-v3.pump.fun/callout/top/' + userId],
    ['frontend leaderboard', 'https://frontend-api-v3.pump.fun/callout/leaderboard?limit=5'],
  ];
  for (const [name, url] of tries) {
    try {
      const r = await fetch(url, {credentials: 'include', headers: {'Content-Type': 'application/json'}});
      out[name] = {status: r.status, body: (await r.text()).slice(0, 500)};
    } catch(e) { out[name] = {err: e.message}; }
  }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
