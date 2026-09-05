// Extract auth tokens from the live session, then POST a callout from page context
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
// 1) dump the auth tokens (values truncated for safety)
const tok = await send("Runtime.evaluate", {expression: `(() => {
  const g = k => { const v = localStorage.getItem(k); return v ? v.slice(0, 30) + '...len=' + v.length : null; };
  return {decodedJwt: g('decoded-jwt'), privyIdToken: g('privy:id_token'), privyToken: g('privy:token'), token: g('token'), auth_token: g('auth_token')};
})()`, returnByValue: true});
console.log("AUTH TOKENS:", JSON.stringify(tok.result.value, null, 1));
ws.close();
