// sell-v4.mjs — REAL trusted mouse clicks (Input.dispatchMouseEvent) at coordinates
const mint = process.argv[2];
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function main() {
  const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
  let page = list.find((t) => t.type === "page" && t.url.includes(mint)) || list.find((t) => t.type === "page" && t.url.includes("/coin/")) || list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
  if (!page) { console.error("no page"); process.exit(2); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; const to = setTimeout(() => { pend.delete(i); rej(new Error(`timeout ${m}`)); }, 25000); pend.set(i, (v) => { clearTimeout(to); res(v); }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } } catch {} };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send("Page.enable"); await send("Runtime.enable");
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  const clickXY = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const btnXY = async (predJs) => {
    const r = await ev(`(() => { const b = ${predJs}; if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), label: (b.textContent||'').trim().slice(0,25)}); })()`);
    return r ? JSON.parse(r) : null;
  };

  console.log("navigating…");
  await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` });
  await sleep(15000);

  // 1) Sell tab — trusted click
  let t = await btnXY(`[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().height < 40 && x.getBoundingClientRect().width < 150)`);
  console.log("1 sell tab:", t);
  if (t) { await clickXY(t.x, t.y); }
  await sleep(3000);

  // 2) 100% — trusted click
  let p = await btnXY(`[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '100%' && x.getBoundingClientRect().width > 50)`);
  console.log("2 100%:", p);
  if (p) { await clickXY(p.x, p.y); }
  await sleep(3000);

  // 3) CTA state
  let cta = await btnXY(`[...document.querySelectorAll('button')].find(x => { const cls = (x.className||'').toString(); const r = x.getBoundingClientRect(); return cls.includes('1FD978') && r.width > 150 && r.height >= 30; })`);
  console.log("3 CTA:", cta);
  await sleep(1000);

  // 4) trusted click CTA
  if (cta) { await clickXY(cta.x, cta.y); }
  console.log("4 clicked CTA");
  await sleep(6000);

  // 5) look for dialog ANYWHERE + any new page (Privy popups open as targets)
  const conf = await ev(`(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"], [class*="dialog"], [class*="modal"]')].find(d => d.getBoundingClientRect().width > 200);
    if (!dlg) return JSON.stringify({type: 'no-dialog'});
    const btns = [...dlg.querySelectorAll('button')];
    const c = btns.find(b => (b.className||'').toString().includes('1FD978')) || btns[btns.length-1];
    return JSON.stringify({type: 'dialog', text: dlg.innerText.slice(0,200).replace(/\\n+/g,' '), lastBtn: c ? (c.textContent||'').trim().slice(0,25) : 'none'});
  })()`);
  console.log("5:", conf);

  const newTabs = (await (await fetch("http://127.0.0.1:9223/json/list")).json()).filter(t => t.type === "page" && !t.url.includes(mint) && !t.url.includes("data:") && t.url.startsWith("http"));
  console.log("5b other tabs:", newTabs.map(t => t.url.slice(0, 80)).join(" | ") || "none");
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
