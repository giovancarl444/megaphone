// Open pump.fun in real Chrome profile + check session state
const PORT = process.env.CDP_PORT || "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page") || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", {url: "https://pump.fun/"});
await new Promise(r => setTimeout(r, 10000));
const st = await send("Runtime.evaluate", {expression: `(() => ({
  url: location.href,
  body: document.body ? document.body.innerText.slice(0, 400) : '',
  cookies: document.cookie.split(';').map(c => c.trim().split('=')[0]).slice(0, 15),
  ls: Object.keys(localStorage).filter(k => /jwt|token|privy|session/i.test(k)).slice(0, 15),
  privy: !!document.querySelector('[class*=privy], iframe[src*=privy]')
}))()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
