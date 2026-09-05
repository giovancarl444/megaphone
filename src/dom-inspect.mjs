// dom-inspect.mjs — full DOM structure check: modals, root divs, script count
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", { expression: `(() => {
  const out = {htmlLen: document.documentElement.outerHTML.length, scripts: document.scripts.length, rootChildren: [], modals: []};
  const root = document.getElementById('root') || document.querySelector('#__next') || document.body.firstElementChild;
  out.rootId = root ? (root.id || root.tagName) : 'none';
  if (root) out.rootChildren = [...root.children].map(c => c.tagName + '.' + (c.className||'').toString().slice(0,40)).slice(0,10);
  document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="overlay" i]').forEach(m => out.modals.push((m.className||'').toString().slice(0,80)));
  // any text in body beyond nav?
  out.bodyText = document.body.innerText.slice(0, 300).replace(/\\n+/g,' | ');
  // check for canvas/iframe
  out.iframes = document.querySelectorAll('iframe').length;
  return JSON.stringify(out);
})()`, returnByValue: true });
console.log(res?.result?.value || "no result");
ws.close();
process.exit(0);
