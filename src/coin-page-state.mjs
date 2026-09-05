// coin-page-state.mjs — what does the coin page ACTUALLY show right now?
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {
  expression: `(() => {
    const t = document.body ? document.body.innerText : '';
    const buyBtns = [...document.querySelectorAll('button')].filter(b => /buy|swap/i.test((b.textContent||'').trim())).map(b => ({t:(b.textContent||'').trim().slice(0,30), disabled: b.disabled, cls: (b.className||'').toString().slice(0,60)}));
    return JSON.stringify({
      url: location.href.slice(0, 80),
      len: t.length,
      head: t.slice(0, 300).replace(/\\n+/g, ' | '),
      buyButtons: buyBtns.slice(0, 5),
      hasBalance: /\\$[0-9.]+/.test(t)
    });
  })()`, returnByValue: true,
});
console.log("PAGE:", res?.result?.value);
ws.close();
process.exit(0);
