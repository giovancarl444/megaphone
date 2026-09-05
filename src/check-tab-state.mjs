// check-tab-state.mjs — what does the pump.fun tab actually show?
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const pages = list.filter((t) => t.type === "page" && t.url.includes("pump.fun"));
console.log("pump.fun tabs:", pages.length);
for (const p of pages) console.log("  ", p.url.slice(0, 90));
// pick the last one (fresh homepage)
const page = pages[pages.length - 1];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const to = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000));
try {
  await Promise.race([new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }), to]);
  await send("Runtime.enable");
  const res = await Promise.race([send("Runtime.evaluate", { expression: `(() => {
    const t = document.body ? document.body.innerText : '';
    const m = t.match(/\\$([0-9.]+)/);
    return JSON.stringify({url: location.href, bodyLen: t.length, balance: m ? m[1] : null, head: t.slice(0,150).replace(/\\n+/g,' | ')});
  })()`, returnByValue: true }), to]);
  console.log("STATE:", res?.result?.value || "no result");
} catch (e) { console.log("ERR:", e.message.slice(0, 100)); }
try { ws.close(); } catch {}
process.exit(0);
