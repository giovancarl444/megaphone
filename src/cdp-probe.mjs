// Probe pump.fun session state in real Chrome (9223) — logged in yet?
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
if (!page) { console.log("no page"); process.exit(0); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const st = await send("Runtime.evaluate", {expression: `(() => {
  const body = document.body ? document.body.innerText : '';
  const ls = Object.keys(localStorage).filter(k => /jwt|token|privy|session|auth/i.test(k));
  return {
    url: location.href,
    loggedIn: /sign in/i.test(body) ? false : /log in to trade/i.test(body) ? false : true,
    bodyHead: body.slice(0, 300),
    lsKeys: ls.slice(0, 20),
    privy: !!document.querySelector('iframe[src*=privy]')
  };
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
