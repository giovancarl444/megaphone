// dom-state.mjs — what's actually rendered + cookie state
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("NO TAB"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Network.enable");
const res = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body ? document.body.innerText : '';
  const html = document.documentElement ? document.documentElement.outerHTML.length : 0;
  const hasWelcome = /welcome|over 18|continue|terms/i.test(t);
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(x => x && x.length < 30).slice(0, 12);
  return JSON.stringify({ len: t.length, htmlLen: html, hasWelcome, buttons: btns, hasRoot: !!document.getElementById('root'), rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1 });
})()`, returnByValue: true });
console.log("DOM:", res?.result?.value);
const cookies = await send("Network.getAllCookies", {});
const pf = (cookies?.cookies || []).filter((c) => c.domain.includes("pump.fun") || c.domain.includes("privy"));
console.log("cookies:", pf.map((c) => `${c.name}=${c.value.slice(0, 15)}...`).join(", "));
ws.close();
process.exit(0);
