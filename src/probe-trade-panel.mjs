// probe-trade-panel.mjs — find Buy/Sell tabs, amount input, and buy button
const mint = process.argv[2] || "4pjvWo2TUzcdzFVn1j54kPw3uBtRM8nr6SKxyTiQ3xyn";
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin page open"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", { expression: `(() => {
  const out = {buySell: [], inputs: [], buttons: []};
  // text elements containing Buy/Sell (tab-like)
  [...document.querySelectorAll('div,span,button,p')].forEach(e => {
    if (e.children.length === 0) {
      const t = (e.textContent||'').trim();
      if (/^(Buy|Sell)$/.test(t)) out.buySell.push(t + '@' + e.tagName);
    }
  });
  document.querySelectorAll('input').forEach(i => out.inputs.push({ph: i.placeholder||'', type: i.type||'', aria: i.getAttribute('aria-label')||''}));
  // last 15 buttons (trade panel usually at bottom)
  [...document.querySelectorAll('button')].forEach(b => {
    const t = (b.textContent||'').trim().replace(/\\s+/g,' ').slice(0,25);
    const cls = (b.className||'').toString().slice(0,60);
    if (t || cls.includes('buy') || cls.includes('sell')) out.buttons.push(t + ' | ' + cls);
  });
  return JSON.stringify(out);
})()`, returnByValue: true });
console.log(JSON.stringify(res?.result?.value, null, 1)?.slice(0, 2500));
ws.close();
