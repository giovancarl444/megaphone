// peek-balance.mjs — FAST read-only balance peek (no navigation, no page reload)
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
// prefer a responsive tab: try each pump.fun page, take first that answers
let page = null;
for (const t of list) {
  if (t.type === "page" && t.url.includes("pump.fun") && !t.url.includes("/profile/")) { page = t; break; }
}
if (!page) page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log(JSON.stringify({ balance: null })); process.exit(0); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("ws timeout")), 6000));
try {
  await Promise.race([new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }), timeout]);
  await send("Runtime.enable");
  const res = await Promise.race([send("Runtime.evaluate", { expression: `(() => {
    const t = document.body.innerText;
    const m = t.match(/\\$([0-9.]+)/);
    return m ? m[1] : null;
  })()`, returnByValue: true }), timeout]);
  console.log(JSON.stringify({ balance: res?.result?.value ?? null }));
} catch (e) {
  console.log(JSON.stringify({ balance: null }));
}
try { ws.close(); } catch {}
process.exit(0);
