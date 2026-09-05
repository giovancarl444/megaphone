// iframe-check.mjs — what's in the iframe?
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
  const frames = [...document.querySelectorAll('iframe')];
  return JSON.stringify(frames.map(f => ({src: (f.src||'').slice(0,100), id: f.id, cls: (f.className||'').toString().slice(0,50)})));
})()`, returnByValue: true });
console.log(res?.result?.value || "no result");
// also list all CDP targets (maybe the app is a separate target/iframe context)
const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json();
console.log("TARGETS:", targets.filter(t => t.type === "page" || t.type === "webview").map(t => t.type + ": " + (t.url || "").slice(0, 80)));
ws.close();
process.exit(0);
