// get-deposit-address.mjs — read the SOL deposit address from the pump.fun session
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("no pump.fun page open"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body.innerText;
  // deposit address is shown as text; look for the wallet pattern (base58 32+ chars)
  const m = t.match(/[1-9A-HJ-NP-Za-km-z]{40,44}/);
  return JSON.stringify({addr: m ? m[0] : null, hasDepositPanel: t.includes('deposit address') || t.includes('DEPOSIT')});
})()`, returnByValue: true });
console.log(res?.result?.value || "no result");
ws.close();
process.exit(0);
