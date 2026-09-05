// Get FULL decoded-jwt blob + privy tokens
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page") || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const dj = await send("Runtime.evaluate", {expression: `(() => {
  const raw = localStorage.getItem('decoded-jwt');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch(e) {}
  return {raw: raw ? raw.slice(0, 2000) : null, parsedKeys: parsed ? Object.keys(parsed) : null};
})()`, returnByValue: true});
console.log(JSON.stringify(dj.result.value, null, 1));
ws.close();
