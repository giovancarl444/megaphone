// probe2.mjs — simpler: connect to the EXISTING pump.fun coin page (BID already open in a tab) and dump DOM
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const pages = list.filter((t) => t.type === "page" && t.url.includes("pump.fun"));
console.log("pump.fun pages:", pages.length);
for (const p of pages) console.log("  ", p.url.slice(0, 90));
const page = pages.find((t) => t.url.includes("/coin/")) || pages[0];
console.log("using:", page.url.slice(0, 100));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", { expression: `JSON.stringify({
  url: location.href,
  buttons: [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30)).filter(Boolean).slice(0,20),
  inputs: [...document.querySelectorAll('input')].map(i => i.placeholder || i.type || '?').slice(0,10),
  hasBuyText: document.body.innerText.includes('Buy'),
  bodyHead: document.body.innerText.slice(0,150)
})`, returnByValue: true });
console.log(res?.result?.value || "NO RESULT");
ws.close();
