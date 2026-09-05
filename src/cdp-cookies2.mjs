// Extract ALL pump.fun cookies via CDP Storage + full decoded-jwt blob
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page") || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
await send("Network.enable");
// 1) cookies via CDP
const ck = await send("Network.getCookies", {urls: ["https://pump.fun", "https://frontend-api-v3.pump.fun", "https://advanced-api-v2.pump.fun"]});
console.log("COOKIES:", JSON.stringify((ck.cookies || []).map(c => ({name: c.name, len: (c.value||'').length, domain: c.domain})), null, 1));
// 2) decoded-jwt full blob
const dj = await send("Runtime.evaluate", {expression: `(() => localStorage.getItem('decoded-jwt'))()`, returnByValue: true});
console.log("DECODED-JWT:", (dj.result.value || '').slice(0, 500));
ws.close();
