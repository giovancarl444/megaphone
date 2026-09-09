// sell-debug.mjs — step through sell, dump real UI state at each step
const mint = process.argv[2];
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function main() {
  const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
  let page = list.find((t) => t.type === "page" && t.url.includes("/coin/"))
      || list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; const to = setTimeout(() => { pend.delete(i); rej(new Error(`timeout ${m}`)); }, 25000); pend.set(i, (v) => { clearTimeout(to); res(v); }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } } catch {} };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send("Page.enable"); await send("Runtime.enable");
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

  const cur = await ev("location.href");
  if (!cur?.includes(mint)) { await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` }); await sleep(12000); }
  await sleep(3000);

  const dump = async (label) => {
    const s = await ev(`(() => {
      const btns = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim().slice(0,24)).filter(Boolean);
      const dlg = document.querySelector('[role="dialog"], [class*="dialog"]');
      const input = [...document.querySelectorAll('input')].map(i => ({ph: i.placeholder||'', val: i.value}));
      const selAmt = [...document.querySelectorAll('button')].find(b => /^(100%|max|all|1\/4|25%)/i.test((b.textContent||'').trim()));
      return JSON.stringify({btns: btns.slice(0, 25), dlgText: dlg ? dlg.innerText.slice(0,200) : null, inputs: input.slice(0,6), hasSellTab: btns.includes('Sell')});
    })()`);
    console.log(label, s);
  };

  // Sell tab
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 40); if (b) b.click(); return !!b; })()`);
  await sleep(2000);
  await dump("after sell tab:");

  // click Max
  const maxR = await ev(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => /^(100%|max|all)$/i.test((x.textContent||'').trim())) || btns.find(x => (x.textContent||'').trim() === 'Max');
    if (!b) return 'none';
    b.click(); return (b.textContent||'').trim();
  })()`);
  console.log("max clicked:", maxR);
  await sleep(2500);
  await dump("after max:");

  // CTA candidates — list all colored CTAs
  const ctas = await ev(`(() => {
    return [...document.querySelectorAll('button')].filter(b => {
      const cls = (b.className||'').toString();
      return /(bg|color|text)/.test(cls) && b.getBoundingClientRect().width > 80;
    }).map(b => ({t: (b.textContent||'').trim().slice(0,20), cls: (b.className||'').toString().match(/(bg-\\[#[0-9A-Fa-f]+\\]|bg-[a-z]+-\\d+)/)?.[0] || '', w: Math.round(b.getBoundingClientRect().width)})).slice(0, 12);
  })()`);
  console.log("CTA candidates:", JSON.stringify(ctas));
  ws.close();
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
