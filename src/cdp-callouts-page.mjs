// Go to home (which renders), click Callouts nav, capture network
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const reqs = [];
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") {
    const r = m.params.request;
    if (/callout|signal/i.test(r.url)) reqs.push({m: r.method, url: r.url.slice(0, 160), body: r.postData || null});
  }
};
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Page.navigate", {url: "https://pump.fun/"});
await new Promise(r => setTimeout(r, 10000));
// click Callouts in nav
const cl = await send("Runtime.evaluate", {expression: `(() => {
  const btns = [...document.querySelectorAll('a, button')];
  const b = btns.find(e => (e.innerText||'').trim() === 'Callouts' && e.offsetParent !== null);
  if (b) { b.click(); return 'clicked: ' + b.tagName + ' href=' + (b.href||''); }
  return 'not found';
})()`, returnByValue: true});
console.log("CLICK:", cl.result.value);
await new Promise(r => setTimeout(r, 8000));
const st = await send("Runtime.evaluate", {expression: `(() => ({url: location.href, body: document.body ? document.body.innerText.slice(0, 500) : ''}))()`, returnByValue: true});
console.log("STATE:", JSON.stringify(st.result.value, null, 1));
console.log("REQS:", JSON.stringify(reqs, null, 1));
ws.close();
