// accept-age-gate.mjs — find and click the Continue/age-gate button
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun") && !t.url.includes("/profile/"));
if (!page) { console.log("no pump.fun tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
// reload to ensure the gate shows
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 10000));
// find all buttons and click the consent one
const res = await send("Runtime.evaluate", { expression: `(() => {
  const btns = [...document.querySelectorAll('button')];
  const info = btns.map((b, i) => ({i, t: (b.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40)}));
  const target = btns.find(b => /continue|agree|accept|over 18|enter/i.test((b.textContent||'').trim())) || btns.find(b => /welcome/i.test(document.body.innerText) && (b.textContent||'').trim());
  if (target) { target.click(); return JSON.stringify({clicked: (target.textContent||'').trim().slice(0,40), all: info.slice(0,15)}); }
  return JSON.stringify({clicked: null, all: info.slice(0,15)});
})()`, returnByValue: true });
console.log("CLICK:", res?.result?.value);
await new Promise((r) => setTimeout(r, 12000));
// check if content mounted now
const res2 = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body ? document.body.innerText : '';
  const m = t.match(/\\$([0-9.]+)/);
  return JSON.stringify({len: t.length, balance: m ? m[1] : null, hasBuy: t.includes('Buy'), head: t.slice(0, 200).replace(/\\n+/g, ' | ')});
})()`, returnByValue: true });
console.log("AFTER:", res2?.result?.value);
ws.close();
process.exit(0);
