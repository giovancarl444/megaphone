// Dump full coin page body to find callout composer structure
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const st = await send("Runtime.evaluate", {expression: `(() => {
  // find any element mentioning callout or signal
  const all = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /call|signal/i.test(e.innerText||'')).map(e => e.innerText.trim()).slice(0,20);
  return {mentions: all, bodyLen: document.body.innerText.length, body: document.body.innerText.slice(0, 800)};
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
