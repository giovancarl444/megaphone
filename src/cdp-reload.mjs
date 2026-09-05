// Reload coin page, wait longer, then dump ALL visible text + buttons
const MINT = process.env.PF_MINT || "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", {url: `https://pump.fun/coin/${MINT}`});
await new Promise(r => setTimeout(r, 15000));
const res = await send("Runtime.evaluate", {expression: `(() => {
  const body = document.body ? document.body.innerText : '';
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean).slice(0, 30);
  return {bodyLen: body.length, body: body.slice(0, 500), btns};
})()`, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
