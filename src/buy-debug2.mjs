// buy-debug2.mjs — watch console errors + click each Buy button variant
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.text + ": " + (m.params.exceptionDetails?.exception?.description || "").slice(0, 200));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map(a => a.value || a.description || "").join(" ").slice(0, 200));
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Set amount
await ev(`(() => {
  const inp = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('Amount') || (i.getAttribute('aria-label')||'').includes('Amount'));
  if (!inp) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '1.2');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await sleep(1000);

// List ALL buy buttons with FULL class + position
console.log("ALL BUY BTNS:", await ev(`(() => {
  const out = [...document.querySelectorAll('button')].map((b, i) => {
    const r = b.getBoundingClientRect();
    return {i, t:(b.textContent||'').trim().slice(0,25), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), cls:(b.className||'').toString().slice(0,120), dis:b.disabled};
  }).filter(b => /^buy$/i.test(b.t) || b.cls.includes('1FD978'));
  return JSON.stringify(out);
})()`));

// Click the one in the trade panel (bottom area, wide: h-10 / flex-1)
console.log("click trade CTA:", await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => {
    const cls = (x.className||'').toString();
    return cls.includes('1FD978') && cls.includes('flex-1') && /^Buy$/i.test((x.textContent||'').trim());
  });
  if (!b) return 'none';
  b.scrollIntoView({block:'center'});
  b.click();
  return 'clicked y=' + Math.round(b.getBoundingClientRect().y);
})()`));
await sleep(6000);
console.log("state:", await ev(`(() => {
  const t = document.body.innerText;
  const dlg = [...document.querySelectorAll('[role="dialog"]')].map(d => (d.textContent||'').slice(0,200));
  return JSON.stringify({ dialog: dlg, balance: (t.match(/\\$[0-9.]+/)||[''])[0], hasSuccess: /successfully|bought/i.test(t) });
})()`));
console.log("ERRORS:", errors.slice(0, 5));
ws.close();
process.exit(0);
