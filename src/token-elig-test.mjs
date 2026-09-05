// token-elig-test.mjs — use drew_patel's session auth_token against the callout API
// Reads the token from the live browser session, checks eligibility + user.
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Network.enable");
const cookies = await send("Network.getAllCookies", {});
const auth = (cookies?.cookies || []).find((c) => c.name === "auth_token" && c.domain.includes("pump.fun"));
const token = auth.value;
console.log("token len:", token.length);

// Who am I?
const me = await fetch("https://frontend-api-v3.pump.fun/users/me", {
  headers: { Authorization: `Bearer ${token}`, Origin: "https://pump.fun" },
});
console.log("users/me:", me.status, (await me.text()).slice(0, 250));

// Eligibility for a coin he holds — pick from the live feed on his page (cupseydih)
// First find what coins he currently holds via the profile API
const prof = await fetch(`https://frontend-api-v3.pump.fun/users/BT7bQZmXqk9ZedacpdWLceEeWemCU6P59zwmBC8bNUUB`, {
  headers: { Authorization: `Bearer ${token}`, Origin: "https://pump.fun" },
});
console.log("profile:", prof.status, (await prof.text()).slice(0, 200));
