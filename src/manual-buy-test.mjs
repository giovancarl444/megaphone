// manual-buy-test.mjs — step-by-step buy with state checks after each action
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Click the Buy TAB (the small one in trade panel header)
console.log("tab:", await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Buy' && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 40);
  if (b) { b.click(); return 'clicked'; } return 'not-found';
})()`));
await sleep(1500);

// 2. Set amount 1.2 with native setter on the AMOUNT (SOL) input specifically
console.log("amount:", await ev(`(() => {
  const inp = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('Amount') || (i.getAttribute('aria-label')||'').includes('Amount'));
  if (!inp) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '1.2');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 'set:' + inp.value;
})()`));
await sleep(1500);

// 3. Check the buy button text now (should show something like "Buy 1.2 SOL" or a USD estimate)
console.log("cta state:", await ev(`(() => {
  const btns = [...document.querySelectorAll('button')].map(b => ({t:(b.textContent||'').trim().slice(0,50), cls:(b.className||'').toString().slice(0,50), dis:b.disabled}));
  return JSON.stringify(btns.filter(b => /buy|swap|confirm/i.test(b.t) && b.t.length > 1).slice(-6));
})()`));

// 4. Click the big green CTA
console.log("cta click:", await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => {
    const cls = (x.className||'').toString();
    return cls.includes('1FD978') && /buy/i.test((x.textContent||''));
  });
  if (!b) return 'no-cta';
  b.scrollIntoView({block:'center'});
  b.click();
  return 'clicked:' + (b.textContent||'').trim().slice(0,30);
})()`));
await sleep(5000);

// 5. Any dialog now?
console.log("after-click:", await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"], [class*="dialog_responsive"]');
  const t = document.body.innerText;
  return JSON.stringify({ dialog: dlg ? (dlg.textContent||'').slice(0, 150) : null, balance: (t.match(/\\$[0-9.]+/)||[''])[0], err: /error|failed|insufficient/i.test(t) });
})()`));
ws.close();
process.exit(0);
