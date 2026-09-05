// Check current pump.fun tab state — logged in as who, any account switcher
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
if (!page) { console.log("no pump.fun page"); process.exit(0); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const st = await send("Runtime.evaluate", {expression: `(() => {
  const body = document.body ? document.body.innerText : '';
  return {url: location.href, bodyHead: body.slice(0, 300), bodyHasSignIn: /sign in/i.test(body), bodyHasLogout: /log out|logout/i.test(body)};
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
