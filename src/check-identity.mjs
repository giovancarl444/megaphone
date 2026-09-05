// check-identity.mjs — which account is this session logged into?
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body.innerText;
  const head = t.slice(0, 500).replace(/\\n+/g, ' | ');
  const token = localStorage.getItem('token') ? 'token-present' : 'no-token';
  const jwt = localStorage.getItem('decoded-jwt');
  let userId = null, name = null;
  try { if (jwt) { const j = JSON.parse(jwt); userId = j.userId || j.id || null; name = j.username || j.name || null; } } catch {}
  return JSON.stringify({head, token, userId, name, addr: (t.match(/[1-9A-HJ-NP-Za-km-z]{40,44}/)||[])[0] || null});
})()`, returnByValue: true });
console.log("RESULT:", res?.result?.value || "no result");
ws.close();
process.exit(0);
