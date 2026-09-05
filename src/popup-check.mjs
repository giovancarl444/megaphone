// popup-check.mjs — click CTA then scan for popups/iframes/targets
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

// set amount + click
await ev(`(() => {
  const inp = [...document.querySelectorAll('input')].find(i => i.getBoundingClientRect().width > 0 && ((i.placeholder||'').includes('Amount') || (i.getAttribute('aria-label')||'').includes('Amount')));
  if (inp) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(inp,'1.2'); inp.dispatchEvent(new Event('input',{bubbles:true})); }
})()`);
await sleep(1500);
console.log("click:", await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => {
    const cls = (x.className||'').toString();
    const r = x.getBoundingClientRect();
    return cls.includes('1FD978') && cls.includes('flex-1') && r.width > 0;
  });
  if (!b) return 'none';
  b.click(); return 'clicked';
})()`));
await sleep(6000);

// scan ALL targets (windows/tabs) after click
const all = await (await fetch("http://127.0.0.1:9223/json/list")).json();
console.log("TARGETS NOW:");
for (const t of all) if (t.type === "page") console.log("  ", t.url.slice(0, 100));

// check iframes in the page
console.log("iframes:", await ev(`(() => { return JSON.stringify([...document.querySelectorAll('iframe')].map(f => ({src:(f.src||'').slice(0,80), w:f.getBoundingClientRect().width}))); })()`));

// check for Privy elements
console.log("privy:", await ev(`(() => { return JSON.stringify({hasPrivyFrame: !!document.querySelector('iframe[src*="privy"]'), hasPrivyModal: !![...document.querySelectorAll('div')].find(d => (d.className||'').toString().includes('privy')), bodyHasPrivy: document.body.innerText.includes('Privy')}); })()`));
ws.close();
process.exit(0);
