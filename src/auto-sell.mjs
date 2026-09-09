/**
 * auto-sell.mjs v2 — VERIFIED sell rail (on-chain confirmed 09-09).
 * Trusted mouse clicks ONLY (synthetic el.click() does NOT register on
 * pump.fun's React panel). Flow: Sell tab -> 100% via Input.dispatchMouseEvent
 * at real coordinates. Verify: caller checks token balance via RPC.
 *
 * Usage: node src/auto-sell.mjs <mint>
 */
const mint = process.argv[2];
if (!mint) { console.error("usage: node src/auto-sell.mjs <mint>"); process.exit(2); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
  let page = list.find((t) => t.type === "page" && t.url.includes(mint))
      || list.find((t) => t.type === "page" && t.url.includes("/coin/"))
      || list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
  if (!page) { console.error("no page"); process.exit(2); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; const to = setTimeout(() => { pend.delete(i); rej(new Error(`CDP timeout ${m}`)); }, 25000); pend.set(i, (v) => { clearTimeout(to); res(v); }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
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
  const tab = await btnXY(`[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().height < 40 && x.getBoundingClientRect().width < 150)`);
  if (!tab) { console.error("SELL_FAIL: no Sell tab"); ws.close(); process.exit(3); }
  await clickXY(tab.x, tab.y);
  console.log("sell tab clicked:", tab.label);
  await sleep(2500);

  // 2) 100% — trusted click (executes the sell on pump.fun)
  const pct = await btnXY(`[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '100%' && x.getBoundingClientRect().width > 50)`);
  if (!pct) { console.error("SELL_FAIL: no 100% button"); ws.close(); process.exit(3); }
  await clickXY(pct.x, pct.y);
  console.log("100% clicked");
  await sleep(4000);

  // 3) if a green CTA exists now (some UI states need it), click it too
  const cta = await btnXY(`[...document.querySelectorAll('button')].find(x => { const cls = (x.className||'').toString(); const r = x.getBoundingClientRect(); return cls.includes('1FD978') && r.width > 150 && r.height >= 30 && !/enter an amount/i.test((x.textContent||'')); })`);
  if (cta) { await clickXY(cta.x, cta.y); console.log("CTA clicked:", cta.label); await sleep(4000); }

  // 4) any confirm dialog (trusted click on its primary button)
  const dlg = await btnXY(`(() => {
    const d = [...document.querySelectorAll('[role="dialog"], [class*="dialog"]')].find(x => x.getBoundingClientRect().width > 200 && x.getBoundingClientRect().height > 100);
    if (!d) return null;
    const b = [...d.querySelectorAll('button')].find(x => { const cls = (x.className||'').toString(); return cls.includes('1FD978') || /confirm|sell|approve/i.test((x.textContent||'')); });
    if (!b) return null; const r = b.getBoundingClientRect();
    return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), label: (b.textContent||'').trim().slice(0,25)});
  })()`);
  if (dlg) { const d = JSON.parse(dlg); await clickXY(d.x, d.y); console.log("confirm clicked:", d.label); await sleep(6000); }
  else console.log("no dialog needed");

  ws.close();
  console.log("SELL_DONE — VERIFY ON-CHAIN (caller must check token balance)");
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
