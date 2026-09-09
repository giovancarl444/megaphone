// sell-v2.mjs — click Sell tab FIRST, then look for input/CTA
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

  // click Sell tab
  const tabR = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().height < 40);
    if (!b) return 'no-tab';
    b.click(); return 'clicked';
  })()`);
  console.log("sell tab:", tabR);
  await sleep(4000);

  // now dump the trade area: inputs, buttons with positions
  const dump = await ev(`(() => {
    const inputs = [...document.querySelectorAll('input')].map(i => ({ph: i.placeholder||'', aria: i.getAttribute('aria-label')||'', w: Math.round(i.getBoundingClientRect().width), visible: i.getBoundingClientRect().width > 0})).filter(i => i.w > 0);
    const btns = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => {
      const cls = (b.className||'').toString(); const r = b.getBoundingClientRect();
      const bg = (cls.match(/bg-\\[#[0-9A-Fa-f]{3,8}\\]/)) ? cls.match(/bg-\\[#[0-9A-Fa-f]{3,8}\\]/)[0] : '';
      return {t: (b.textContent||'').trim().slice(0,20), bg, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)};
    }).filter(b => b.t || b.bg).slice(-25);
    return JSON.stringify({inputs, btns});
  })()`);
  console.log("trade area:", dump);
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
