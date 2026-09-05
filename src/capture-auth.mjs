// capture-auth.mjs — intercept the page's own API requests to see the REAL auth header
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const reqs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Network.requestWillBeSent") {
    const r = m.params.request;
    if (r.url.includes("frontend-api-v3") || r.url.includes("pump.fun/api")) {
      const h = r.headers || {};
      reqs.push({ url: r.url.slice(0, 90), auth: h.authorization || h.Authorization || "NONE", cookie: (h.cookie || "").slice(0, 60) });
    }
  }
};
await new Promise((r) => (ws.onopen = r));
await send("Network.enable");
// trigger some API activity: reload
await send("Page.enable");
await send("Page.reload", { ignoreCache: false });
await new Promise((r) => setTimeout(r, 12000));
console.log("captured requests:", reqs.length);
const seen = new Set();
for (const r of reqs) {
  const k = r.url + r.auth.slice(0, 40);
  if (seen.has(k)) continue; seen.add(k);
  console.log(`  ${r.url.slice(0, 70)}\n    auth: ${r.auth.slice(0, 60)}...\n    cookie: ${r.cookie}...`);
}
ws.close();
process.exit(0);
