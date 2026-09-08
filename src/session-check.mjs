// session-check.mjs — quick auth state check
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("NO TAB"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
// reload to ensure content mounts
await send("Page.reload", { ignoreCache: false });
await new Promise((r) => setTimeout(r, 15000));
const res = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body ? document.body.innerText : '';
  const own = [...document.querySelectorAll('a[href*="/profile/"]')].map(a => a.getAttribute('href')).find(h => h.includes('BT7bQZmX'));
  const bal = t.match(/\\$[0-9]+\\.[0-9]+/);
  return JSON.stringify({ url: location.href.slice(0, 60), len: t.length, ownProfile: !!own, balance: bal ? bal[0] : null, signedOut: t.includes('Sign in'), head: t.slice(0, 100).replace(/\\n+/g, ' | ') });
})()`, returnByValue: true });
console.log("STATE:", res?.result?.value);
ws.close();
process.exit(0);
