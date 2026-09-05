// all-auth-cookies.mjs — list every auth_token cookie with domain, then test each against users/me
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Network.enable");
const cookies = await send("Network.getAllCookies", {});
const auths = (cookies?.cookies || []).filter((c) => c.name === "auth_token");
console.log("auth_token cookies found:", auths.length);
for (const c of auths) {
  console.log(`  domain=${c.domain} path=${c.path} len=${c.value.length} val=${c.value.slice(0, 25)}...`);
  try {
    const r = await fetch("https://frontend-api-v3.pump.fun/users/me", {
      headers: { Authorization: `Bearer ${c.value}`, Origin: "https://pump.fun" },
    });
    const j = await r.json().catch(() => ({}));
    console.log(`    -> users/me: ${r.status} address=${j.address || "?"} user=${j.username || "?"} userId=${j.userId || "?"}`);
  } catch (e) { console.log(`    -> fetch err ${e.message.slice(0, 60)}`); }
}
ws.close();
process.exit(0);
