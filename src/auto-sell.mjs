/**
 * auto-sell.mjs — CDP-driven sell of a pump.fun position (the profit rail).
 * Twin of auto-buy.mjs: Sell tab -> 100% (MAX) -> red CTA -> confirm -> verify.
 *
 * Usage: node src/auto-sell.mjs <mint>
 */
const mint = process.argv[2];
if (!mint) { console.error("usage: node src/auto-sell.mjs <mint>"); process.exit(2); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
  let page = list.find((t) => t.type === "page" && t.url.includes("/coin/"))
      || list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
  if (!page) {
    const r = await fetch(`http://127.0.0.1:9223/json/new?${encodeURIComponent(`https://pump.fun/coin/${mint}`)}`, { method: "PUT" });
    page = await r.json();
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; const to = setTimeout(() => { pend.delete(i); rej(new Error(`CDP timeout ${m}`)); }, 25000); pend.set(i, (v) => { clearTimeout(to); res(v); }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } } catch {} };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send("Page.enable"); await send("Runtime.enable");

  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

  // navigate if needed
  const cur = await ev("location.href");
  if (!cur?.includes(mint)) {
    await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` });
    await sleep(12000);
  }
  await sleep(2000);

  // 0) pre-flight: do we hold this coin? (holding chip shows amount or "you hold")
  const held = await ev(`(() => {
    const t = document.body.innerText.toLowerCase();
    const hasHolding = t.includes('you hold') || t.includes('position') || /holdings?/.test(t);
    const m = t.match(/([0-9.]+)\\s*\\n?$/) ;
    return JSON.stringify({hasHolding, bodyLen: document.body.innerText.length});
  })()`);
  console.log("pre-flight:", held);

  // 1) Sell tab
  const tab = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 40);
    if (b) { b.click(); return 'ok'; }
    return 'not-found';
  })()`);
  console.log("sell tab:", tab);
  await sleep(1500);

  // 2) MAX / 100% button — sell entire position
  const setMax = await ev(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => /^(100%|max|all)$/i.test((x.textContent||'').trim())) || btns.find(x => (x.textContent||'').trim() === 'Max');
    if (!b) return 'no-max-btn';
    b.click();
    return 'clicked:' + (b.textContent||'').trim();
  })()`);
  console.log("max:", setMax);
  await sleep(1500);

  // 3) red CTA (sell is usually red/rose — find button whose text is Sell-ish w/ red bg, fallback: any CTA with Sell text)
  const cta = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => {
      const cls = (x.className||'').toString();
      const t = (x.textContent||'').trim();
      return (cls.includes('FF5C5C') || cls.includes('f23b69') || cls.includes('red') || cls.includes('rose')) && t.toLowerCase().includes('sell');
    }) || [...document.querySelectorAll('button')].find(x => {
      const cls = (x.className||'').toString();
      const t = (x.textContent||'').trim();
      return cls.includes('1FD978') === false && t === 'Sell' && x.getBoundingClientRect().width > 60;
    });
    if (!b) return 'no-cta';
    b.scrollIntoView({block:'center'});
    b.click();
    return 'clicked:' + (b.textContent||'').trim();
  })()`);
  console.log("CTA:", cta);
  await sleep(4000);

  // 4) confirmation dialog
  const conf = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"], [class*="dialog_responsive"]');
    if (!dlg) return 'no-dialog';
    const btns = [...dlg.querySelectorAll('button')];
    const c = btns.find(b => (b.textContent||'').trim().toLowerCase().includes('sell') || (b.className||'').toString().includes('FF5C5C') || (b.className||'').toString().includes('red') || (b.className||'').toString().includes('rose'))
      || btns[btns.length-1];
    if (c) { c.click(); return 'confirmed:' + (c.textContent||'').trim().slice(0,20); }
    return 'dialog-open-no-btn:' + (dlg.innerText||'').slice(0,80).replace(/\\n+/g,' ');
  })()`);
  console.log("confirm:", conf);
  await sleep(8000);

  // 5) verify
  const state = await ev(`(() => {
    const tail = document.body.innerText.slice(-600).toLowerCase();
    return JSON.stringify({hasError: /error|failed|insufficient|not enough|rejected/.test(tail), hasSuccess: /success|sold|confirmed|complete/.test(tail)});
  })()`);
  console.log("state:", state);

  ws.close();
  console.log("SELL_DONE");
  process.exit(0);
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
