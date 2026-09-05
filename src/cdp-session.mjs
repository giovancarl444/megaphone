// Robust: find a page tab, navigate to pump.fun, check session
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter(t => t.type === "page");
console.log("pages:", pages.map(p => p.url.slice(0, 60)));
const page = pages.find(p => p.url.includes("pump.fun")) || pages[0];
if (!page) { console.log("no page tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", {url: "https://pump.fun/"});
await new Promise(r => setTimeout(r, 9000));
const st = await send("Runtime.evaluate", {expression: `(() => {
  const body = document.body ? document.body.innerText : '';
  const ls = Object.keys(localStorage).filter(k => /privy|jwt|decoded/i.test(k));
  return {url: location.href, loggedIn: ls.length > 0, lsKeys: ls.slice(0,8), bodyHead: body.slice(0, 200)};
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
