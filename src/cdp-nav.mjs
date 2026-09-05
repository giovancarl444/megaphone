// Minimal CDP driver: navigate + dump page state
const TARGET = process.argv[2] || "https://pump.fun/";
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page") || list[0];
console.log("target:", page.url, page.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params={}) {
  return new Promise((res, rej) => {
    const i = ++id; pending.set(i, {res, rej});
    ws.send(JSON.stringify({id: i, method, params}));
  });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
};
await new Promise(r => ws.onopen = r);
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", {url: TARGET});
await new Promise(r => setTimeout(r, 8000));
const res = await send("Runtime.evaluate", {expression: `({title: document.title, url: location.href, body: document.body ? document.body.innerText.slice(0, 300) : ''})`, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
