/**
 * auto-buy.mjs v2 — CDP-driven $1 buy on pump.fun (the callout gate).
 *
 * Robust flow: close any open dialog -> activate Buy tab -> type amount ->
 * click green CTA (bg-[#1FD978]) -> confirm if dialog -> verify balance moved.
 *
 * Usage: node src/auto-buy.mjs <mint> [amountUsd]
 */
const mint = process.argv[2];
const amount = Number(process.argv[3] || 1);
if (!mint) { console.error("usage: node src/auto-buy.mjs <mint> [amountUsd]"); process.exit(2); }

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
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; const to = setTimeout(() => { pend.delete(i); rej(new Error(`CDP timeout ${m}`)); }, 20000); pend.set(i, (v) => { clearTimeout(to); res(v); }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } } catch {} };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send("Page.enable"); await send("Runtime.enable");

  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

  // navigate if needed
  const cur = await ev("location.href");
  if (!cur?.includes(mint)) {
    await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` });
    await sleep(10000);
  }
  await sleep(1500);

  // 0) PRE-FLIGHT: check session balance before anything (never attempt with < $2)
  const preBal = await ev(`(() => {
    const t = document.body.innerText;
    const m = t.match(/\\$([0-9.]+)/);
    return m ? parseFloat(m[1]) : null;
  })()`);
  console.log("pre-flight balance: $", preBal);
  if (preBal !== null && preBal < 2) {
    console.error("⚠️ session balance too low for auto-buy ($" + preBal + ") — skipping (founder top-up needed)");
    ws.close();
    process.exit(3);
  }

  // 0b) close any open dialog (aria-label Close)
  const closed = await ev(`(() => {
    const c = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Close' && b.getBoundingClientRect().width > 0);
    if (c) { c.click(); return 'closed'; }
    return 'none-open';
  })()`);
  console.log("dialog:", closed);
  await sleep(1200);

  // 1) Buy tab (visible)
  const tab = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Buy' && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 40);
    if (b) { b.click(); return 'ok'; }
    return 'not-found';
  })()`);
  console.log("buy tab:", tab);
  await sleep(1500);

  // 2) amount
  const setAmt = await ev(`(() => {
    const inp = [...document.querySelectorAll('input')].find(i => (i.getAttribute('aria-label')||'').includes('Amount') || (i.placeholder||'').toLowerCase().includes('amount'));
    if (!inp) return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '${amount}');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.focus();
    return 'set';
  })()`);
  console.log("amount:", setAmt);
  await sleep(1500);

  // 3) green CTA (bg-[#1FD978]) — click even if it needs scroll into view
  const cta = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => {
      const cls = (x.className||'').toString();
      const t = (x.textContent||'').trim();
      return cls.includes('1FD978') && (t === 'Buy' || t.includes('Buy'));
    });
    if (!b) return 'no-cta';
    b.scrollIntoView({block:'center'});
    b.click();
    return 'clicked';
  })()`);
  console.log("CTA:", cta);
  await sleep(4000);

  // 4) confirmation dialog? click the green confirm
  const conf = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"], [class*="dialog_responsive"]');
    if (!dlg) return 'no-dialog';
    const btns = [...dlg.querySelectorAll('button')];
    const c = btns.find(b => {
      const t = (b.textContent||'').trim().toLowerCase();
      const cls = (b.className||'').toString();
      return (t.includes('confirm') || t.includes('buy')) && (cls.includes('1FD978') || cls.includes('green') || cls.includes('primary') || t.includes('buy'));
    }) || btns.find(b => (b.className||'').toString().includes('1FD978'));
    if (c) { c.click(); return 'confirmed:' + (c.textContent||'').trim().slice(0,20); }
    return 'dialog-open-no-btn:' + (dlg.innerText||'').slice(0,80).replace(/\\n+/g,' ');
  })()`);
  console.log("confirm:", conf);
  await sleep(6000);

  // 5) verify: check balance chip + any error text
  const state = await ev(`(() => {
    const els = [...document.querySelectorAll('span,div')];
    const bal = els.find(e => e.children.length === 0 && /^\\$[0-9.]+$/.test((e.textContent||'').trim()));
    const tail = document.body.innerText.slice(-500).toLowerCase();
    return JSON.stringify({balance: bal ? bal.textContent.trim() : '?', hasError: /error|failed|insufficient|not enough/.test(tail), hasSuccess: /success|confirmed|position/.test(tail)});
  })()`);
  console.log("state:", state);

  ws.close();
  console.log("DONE — check holdings, then post callout");
  process.exit(0);
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
