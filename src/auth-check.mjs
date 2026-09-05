// auth-check.mjs — check login state on all pump.fun tabs
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const pages = list.filter((t) => t.type === "page" && t.url.includes("pump.fun"));
console.log("pump.fun tabs:", pages.length);
for (const p of pages) {
  console.log("  TAB:", p.url.slice(0, 80));
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p2 = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p2 })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const to = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 7000));
  try {
    await Promise.race([new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }), to]);
    await send("Runtime.enable");
    const res = await Promise.race([send("Runtime.evaluate", { expression: `(() => {
      const t = document.body ? document.body.innerText : '';
      const ls = {};
      try { ls.token = localStorage.getItem('token') ? 'YES' : 'NO'; } catch {}
      return JSON.stringify({len: t.length, hasSignIn: t.includes('Sign in'), hasBalance: /\\$[0-9.]+/.test(t), head: t.slice(0, 80).replace(/\\n+/g,' | '), token: ls.token});
    })()`, returnByValue: true }), to]);
    console.log("    STATE:", res?.result?.value?.slice(0, 200));
  } catch (e) { console.log("    HUNG:", e.message.slice(0, 50)); }
  try { ws.close(); } catch {}
}
process.exit(0);
