// ui-account.mjs — which account is the pump.fun UI logged in as?
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("no tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
// find profile links / avatar hrefs in the DOM
const res = await send("Runtime.evaluate", { expression: `(() => {
  const links = [...document.querySelectorAll('a[href*="/profile/"]')].map(a => a.getAttribute('href')).slice(0, 10);
  const imgs = [...document.querySelectorAll('img[src*="pumpatar"]')].map(i => i.src).slice(0, 3);
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(t => t && t.length < 25).slice(0, 15);
  const t = document.body ? document.body.innerText : '';
  const bal = t.match(/\\$[0-9]+\\.[0-9]+/);
  return JSON.stringify({profileLinks: links, avatarImgs: imgs.slice(0,2), buttons: btns, balance: bal ? bal[0] : null, hasCreate: t.includes('Create'), hasSignIn: t.includes('Sign in')});
})()`, returnByValue: true });
console.log(res?.result?.value);
ws.close();
process.exit(0);
