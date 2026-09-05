// trusted-click-buy.mjs — REAL mouse click (trusted event) on the Buy CTA
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

// set amount first (trusted typing via Input.insertText after focus)
await ev(`(() => {
  const inp = [...document.querySelectorAll('input')].find(i => i.getBoundingClientRect().width > 0 && ((i.placeholder||'').includes('Amount') || (i.getAttribute('aria-label')||'').includes('Amount')));
  if (!inp) return 'no-input';
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  s.call(inp, '');
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.focus();
  return 'focused';
})()`);
await sleep(800);
// find CTA coords
const pos = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => {
    const cls = (x.className||'').toString();
    const r = x.getBoundingClientRect();
    return cls.includes('1FD978') && cls.includes('flex-1') && r.width > 0;
  });
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
})()`);
console.log("CTA center:", JSON.stringify(pos));
if (!pos) { console.log("no CTA"); process.exit(1); }

// type 1.2 with real key events
await send("Input.dispatchKeyEvent", { type: "keyDown", text: "1" });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "1" });
await send("Input.dispatchKeyEvent", { type: "keyDown", text: "." });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "." });
await send("Input.dispatchKeyEvent", { type: "keyDown", text: "2" });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "2" });
await sleep(1500);
console.log("input value:", await ev(`(() => { const i=[...document.querySelectorAll('input')].find(x=>x.getBoundingClientRect().width>0); return i?i.value:'none'; })()`));

// TRUSTED click via CDP mouse events
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
console.log("trusted click sent at", pos.x, pos.y);
await sleep(6000);

// check result: dialog? new frame? success? balance?
console.log("result:", await ev(`(() => {
  const t = document.body.innerText;
  const dlg = [...document.querySelectorAll('[role="dialog"]')].map(d => (d.textContent||'').slice(0, 200));
  const privyVisible = [...document.querySelectorAll('iframe')].filter(f => (f.src||'').includes('privy') && f.getBoundingClientRect().width > 0).length;
  return JSON.stringify({ dialogs: dlg, balance: (t.match(/\\$[0-9.]+/)||[''])[0], privyVisible, success: /successfully|transaction/i.test(t) });
})()`));
ws.close();
process.exit(0);
