// sell-v3.mjs — CORRECT flow: Sell tab -> 100% -> green "Enter an amount" CTA -> confirm
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

  console.log("navigating…");
  await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` });
  await sleep(15000);

  // 1) Sell tab
  const tabR = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().height < 40 && x.getBoundingClientRect().width < 150);
    if (!b) return 'no-tab';
    b.click(); return 'clicked';
  })()`);
  console.log("1 sell tab:", tabR);
  await sleep(3000);

  // 2) click 100% (sets full position)
  const pctR = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '100%' && x.getBoundingClientRect().width > 50);
    if (!b) return 'no-100';
    b.click(); return 'clicked';
  })()`);
  console.log("2 100%:", pctR);
  await sleep(3000);

  // 3) check CTA state now — text should change from "Enter an amount" to "Sell"
  const ctaState = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => {
      const cls = (x.className||'').toString();
      const r = x.getBoundingClientRect();
      return cls.includes('1FD978') && r.width > 150 && r.height >= 30;
    });
    return b ? (b.textContent||'').trim() : 'no-green-cta';
  })()`);
  console.log("3 CTA label now:", ctaState);
  await sleep(1000);

  // 4) click the green CTA (whatever its label — Sell/Enter an amount)
  const ctaR = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => {
      const cls = (x.className||'').toString();
      const r = x.getBoundingClientRect();
      return cls.includes('1FD978') && r.width > 150 && r.height >= 30;
    });
    if (!b) return 'no-green-cta';
    b.scrollIntoView({block:'center'}); b.click();
    return 'clicked:' + (b.textContent||'').trim().slice(0,25);
  })()`);
  console.log("4 CTA:", ctaR);
  await sleep(6000);

  // 5) dialog?
  const conf = await ev(`(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"], [class*="dialog"]')].find(d => d.getBoundingClientRect().width > 200 && d.getBoundingClientRect().height > 100);
    if (!dlg) return 'no-dialog';
    const btns = [...dlg.querySelectorAll('button')];
    const c = btns.find(b => (b.className||'').toString().includes('1FD978')) || btns[btns.length-1];
    if (c) { c.click(); return 'confirmed:' + (c.textContent||'').trim().slice(0,20); }
    return 'dialog:' + dlg.innerText.slice(0,150).replace(/\\n+/g,' ');
  })()`);
  console.log("5 confirm:", conf);
  await sleep(12000);

  const st = await ev(`(() => { const t = document.body.innerText.toLowerCase(); return JSON.stringify({err: /error|failed|insufficient|rejected/.test(t.slice(-800)), ok: /success|sold|completed|transaction/.test(t.slice(-800)), pos: (t.match(/position\\$[0-9.]+/)||[''])[0]}); })()`);
  console.log("6 state:", st);
  ws.close();
  console.log("SELL_V3_DONE");
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
