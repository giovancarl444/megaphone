// hard-reload-test.mjs — reload + wait 20s, check content mount
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun") && !t.url.includes("/profile/"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 20000));
const res = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body ? document.body.innerText : '';
  const m = t.match(/\\$([0-9.]+)/);
  return JSON.stringify({url: location.href, len: t.length, balance: m ? m[1] : null, hasBuy: t.includes('Buy'), head: t.slice(0, 250).replace(/\\n+/g, ' | ')});
})()`, returnByValue: true });
console.log("AFTER RELOAD:", res?.result?.value || "no result");
ws.close();
process.exit(0);
