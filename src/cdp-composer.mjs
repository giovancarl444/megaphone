// Find the callout composer on the coin page — dump interactive elements near 'callout'
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {expression: `(() => {
  // only VISIBLE elements with text mentioning callout/signal, exclude style/script
  const walker = [...document.querySelectorAll('button, a, [role=button], input, textarea, [contenteditable=true]')];
  const hits = walker.filter(e => {
    const t = (e.innerText || e.placeholder || e.getAttribute('aria-label') || '');
    return /call|signal|post|community|share/i.test(t) && e.offsetParent !== null;
  }).map(e => ({tag: e.tagName, text: (e.innerText||'').trim().slice(0,60), ph: e.placeholder||'', aria: e.getAttribute('aria-label')||''}));
  return hits.slice(0, 25);
})()`, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
