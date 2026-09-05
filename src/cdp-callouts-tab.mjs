// Click Callouts tab on coin page, find composer, capture network
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const events = [];
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") events.push(m.params);
};
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
// click Callouts tab
const cl = await send("Runtime.evaluate", {expression: `(() => {
  const els = [...document.querySelectorAll('button, [role=button], div, a')];
  const b = els.find(x => (x.innerText||'').trim() === 'Callouts' && x.offsetParent);
  if (b) { b.click(); return 'clicked: ' + b.tagName; }
  return 'not found';
})()`, returnByValue: true});
console.log(cl.result.value);
await new Promise(r => setTimeout(r, 4000));
// dump visible callout-related UI + inputs
const st = await send("Runtime.evaluate", {expression: `(() => {
  const inputs = [...document.querySelectorAll('input, textarea, [contenteditable=true]')].map(i => ({tag: i.tagName, ph: i.placeholder||'', contenteditable: i.getAttribute('contenteditable')})).slice(0,10);
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean).filter(t => /call|signal|post|share|send/i.test(t)).slice(0,10);
  return {inputs, btns, bodyTail: document.body.innerText.slice(-400)};
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
