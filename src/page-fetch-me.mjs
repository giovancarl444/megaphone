// page-fetch-me.mjs — run fetch INSIDE the page context so cookies flow naturally
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {
  expression: `(async () => {
    const r = await fetch('https://frontend-api-v3.pump.fun/users/me', { headers: { 'Accept': 'application/json' }, credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    return JSON.stringify({ status: r.status, me: { address: j.address, username: j.username, userId: j.userId } });
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log("page-context users/me:", res?.result?.value);
ws.close();
process.exit(0);
