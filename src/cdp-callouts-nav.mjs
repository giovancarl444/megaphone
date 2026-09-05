// Click the Callouts nav button, capture network, dump what opens
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const posts = [];
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent" && m.params.request.method === "POST") posts.push({url: m.params.request.url, headers: m.params.request.headers});
};
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
const cl = await send("Runtime.evaluate", {expression: `(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => (x.innerText||'').trim() === 'Callouts');
  if (b) { b.click(); return 'clicked'; }
  return 'not found';
})()`, returnByValue: true});
console.log(cl.result.value);
await new Promise(r => setTimeout(r, 5000));
const st = await send("Runtime.evaluate", {expression: `(() => {
  const body = document.body ? document.body.innerText : '';
  const dialogs = [...document.querySelectorAll('[role=dialog], [class*=modal], [class*=dialog]')].map(d => (d.innerText||'').slice(0,200));
  const inputs = [...document.querySelectorAll('textarea, [contenteditable=true]')].map(i => i.tagName);
  return {url: location.href, bodyLen: body.length, bodyTail: body.slice(-500), dialogs: dialogs.slice(0,3), textareas: inputs};
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
console.log("POSTS:", JSON.stringify(posts.slice(-5), null, 1));
ws.close();
