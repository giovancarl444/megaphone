// session-live.mjs — confirm drew_patel session is alive: avatar link + balance in DOM
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("NO PUMP.FUN TAB"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {
  expression: `(() => {
    const t = document.body ? document.body.innerText : '';
    const own = [...document.querySelectorAll('a[href*="/profile/"]')].map(a => a.getAttribute('href')).find(h => h.includes('BT7bQZmX'));
    const bal = t.match(/\\$[0-9]+\\.[0-9]+/);
    const signIn = t.includes('Sign in');
    return JSON.stringify({ url: location.href.slice(0, 60), ownProfileLink: !!own, balance: bal ? bal[0] : null, signedOut: signIn, bodyLen: t.length });
  })()`, returnByValue: true,
});
console.log("SESSION:", res?.result?.value);
ws.close();
process.exit(0);
