// buy-after-reload.mjs — reload coin page fully, wait longer, then buy
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fresh navigation (not reload — forces full SPA boot)
await send("Page.navigate", { url: "https://pump.fun/coin/3HS8oSo6m631YaN7borgBakpv9cDBUPw6nQs66nQV3TG" });
await sleep(15000);
console.log("loaded:", await ev(`(() => { const t=document.body.innerText; return JSON.stringify({len:t.length, has: t.includes('3123')}); })()`));

// measure CTA size
console.log("CTA size:", await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => {
    const cls = (x.className||'').toString();
    return cls.includes('1FD978') && cls.includes('flex-1');
  });
  if (!b) return 'none';
  const r = b.getBoundingClientRect();
  return JSON.stringify({w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y)});
})()`));

// set amount via native setter on the visible input
await ev(`(() => {
  const inp = [...document.querySelectorAll('input')].find(i => i.getBoundingClientRect().width > 0 && ((i.placeholder||'').includes('Amount') || (i.getAttribute('aria-label')||'').includes('Amount')));
  if (!inp) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '1.2');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 'set';
})()`);
await sleep(2000);
console.log("after amount:", await ev(`(() => { const t=document.body.innerText; return JSON.stringify({ctaText: [...document.querySelectorAll('button')].filter(b=>{const c=(b.className||'').toString(); return c.includes('1FD978')&&c.includes('flex-1');}).map(b=>(b.textContent||'').trim()), balance: (t.match(/\\$[0-9.]+/)||[''])[0]}); })()`));
ws.close();
process.exit(0);
