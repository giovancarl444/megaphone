// Inject JWT into localStorage (pump.fun pattern) + set cookies, then reload
const TOKEN = process.env.PF_TOKEN;
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
await send("Network.enable");
const r = await send("Runtime.evaluate", {expression: `(() => {
  localStorage.setItem('auth_token', ${JSON.stringify(TOKEN)});
  localStorage.setItem('jwt', ${JSON.stringify(TOKEN)});
  localStorage.setItem('token', ${JSON.stringify(TOKEN)});
  return 'set';
})()`, returnByValue: true});
console.log(r.result.value);
await send("Network.setCookie", {name: "auth_token", value: TOKEN, domain: ".pump.fun", path: "/", secure: true});
await send("Page.reload");
await new Promise(r => setTimeout(r, 6000));
const st = await send("Runtime.evaluate", {expression: `({url: location.href, body: document.body ? document.body.innerText.slice(0, 250) : '', ls: Object.keys(localStorage).slice(0,20)})`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
