// Open the sign-in modal so the user can log in, then verify session state
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const cl = await send("Runtime.evaluate", {expression: `(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => /sign in/i.test(x.innerText||''));
  if (b) { b.click(); return 'clicked sign in'; }
  return 'no sign-in btn found';
})()`, returnByValue: true});
console.log(cl.result.value);
await new Promise(r => setTimeout(r, 4000));
const st = await send("Runtime.evaluate", {expression: `(() => {
  const body = document.body ? document.body.innerText : '';
  return {bodyTail: body.slice(-800)};
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
