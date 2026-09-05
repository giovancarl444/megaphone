// get-deposit2.mjs — click Add SOL to open the deposit dialog, then read the address
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await new Promise((r) => setTimeout(r, 7000)); // let page load

// find Add SOL / deposit buttons and click
const clickRes = await send("Runtime.evaluate", { expression: `(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => (x.textContent||'').trim().toLowerCase().includes('add sol') || (x.textContent||'').trim().toLowerCase() === 'deposit');
  if (b) { b.click(); return 'clicked:' + (b.textContent||'').trim(); }
  return 'not-found';
})()`, returnByValue: true });
console.log("click:", clickRes?.result?.value);
await new Promise((r) => setTimeout(r, 3000));

const res = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body.innerText;
  const m = t.match(/[1-9A-HJ-NP-Za-km-z]{40,44}/);
  const dlg = document.querySelector('[role="dialog"], [class*="dialog"]');
  return JSON.stringify({addr: m ? m[0] : null, dlgText: dlg ? (dlg.innerText||'').slice(0,300).replace(/\\n+/g,' | ') : 'no-dialog', balance: (t.match(/\\$[0-9.]+/)||[])[0] || null});
})()`, returnByValue: true });
console.log("RESULT:", res?.result?.value);
ws.close();
process.exit(0);
