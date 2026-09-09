// sell-fixed.mjs — reliable sell: reload page, wait for panel, use REAL CTA coords
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

  // fresh reload, wait for trade panel
  console.log("navigating…");
  await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` });
  let mounted = false;
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const m = await ev(`(() => {
      const btns = [...document.querySelectorAll('button')];
      return JSON.stringify({
        hasSell: btns.some(b => (b.textContent||'').trim() === 'Sell' && b.getBoundingClientRect().height < 40),
        hasBuy: btns.some(b => (b.textContent||'').trim() === 'Buy' && b.getBoundingClientRect().height < 40),
        len: document.body.innerText.length,
        amt: [...document.querySelectorAll('input')].filter(i => i.getBoundingClientRect().width > 50).length
      });
    })()`);
    const j = JSON.parse(m || '{}');
    if (j.hasSell && j.amt >= 1) { mounted = true; console.log("panel mounted after", (i+1)*5, "s", m); break; }
    console.log("waiting for panel…", m);
  }
  if (!mounted) { console.error("PANEL NEVER MOUNTED"); ws.close(); process.exit(3); }

  // 1) Sell tab
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().height < 40); if (b) b.click(); return !!b; })()`);
  await sleep(2000);
  // 2) Max
  const maxR = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^(100%|max|all)$/i.test((x.textContent||'').trim()));
    if (b) { b.click(); return (b.textContent||'').trim(); }
    return 'none';
  })()`);
  console.log("max:", maxR);
  await sleep(2000);
  // 3) find the REAL CTA: full-width button inside the trade card with bg-[#1FD978] (sell uses same green CTA) — dump all big buttons
  const ctas = await ev(`(() => {
    return [...document.querySelectorAll('button')].filter(b => {
      const r = b.getBoundingClientRect();
      const cls = (b.className||'').toString();
      return r.width > 150 && r.height >= 30 && (cls.includes('bg-') || /(Buy|Sell)/.test(b.textContent||''));
    }).map(b => ({t: (b.textContent||'').trim().slice(0,25), cls: (b.className||'').toString().match(/bg-\\[#[0-9A-Fa-f]{3,8}\\]/)?.[0] || '', w: Math.round(b.getBoundingClientRect().width), x: Math.round(b.getBoundingClientRect().x), y: Math.round(b.getBoundingClientRect().y)}));
  })()`);
  console.log("big buttons:", JSON.stringify(ctas));

  // click the one that's green bg (1FD978) — the actual trade submit
  const ctaR = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => {
      const cls = (x.className||'').toString();
      const r = x.getBoundingClientRect();
      return cls.includes('1FD978') && r.width > 150 && r.height >= 30;
    });
    if (!b) return 'no-green-cta';
    b.scrollIntoView({block:'center'}); b.click();
    return 'clicked';
  })()`);
  console.log("cta:", ctaR);
  await sleep(5000);

  // 4) dialog confirm
  const conf = await ev(`(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"], [class*="dialog"]')].find(d => d.getBoundingClientRect().width > 100);
    if (!dlg) return 'no-dialog';
    const btns = [...dlg.querySelectorAll('button')];
    const c = btns.find(b => (b.className||'').toString().includes('1FD978')) || btns[btns.length-1];
    if (c) { c.click(); return 'confirmed:' + (c.textContent||'').trim().slice(0,20); }
    return 'dialog:' + dlg.innerText.slice(0,120).replace(/\\n+/g,' ');
  })()`);
  console.log("confirm:", conf);
  await sleep(10000);

  const st = await ev(`(() => { const t = document.body.innerText.toLowerCase(); return JSON.stringify({err: /error|failed|insufficient|rejected/.test(t.slice(-800)), ok: /success|sold|completed/.test(t.slice(-800))}); })()`);
  console.log("state:", st);
  ws.close();
  console.log("SELL_ATTEMPT_DONE");
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
