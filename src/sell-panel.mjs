// sell-panel.mjs — dump ALL buttons with classes/rects on the coin page after switching to Sell
const mint = process.argv[2];
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function main() {
  const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
  const page = list.find((t) => t.type === "page" && t.url.includes(mint)) || list.find((t) => t.type === "page" && t.url.includes("/coin/")) || list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; const to = setTimeout(() => { pend.delete(i); rej(new Error(`timeout ${m}`)); }, 25000); pend.set(i, (v) => { clearTimeout(to); res(v); }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } } catch {} };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send("Page.enable"); await send("Runtime.enable");
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

  const cur = await ev("location.href");
  console.log("url:", cur);
  // ensure we're on the coin page
  if (!cur?.includes(mint)) { await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` }); await sleep(12000); }
  await sleep(2000);

  const dump = async (label) => {
    const s = await ev(`(() => {
      const out = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => {
        const r = b.getBoundingClientRect();
        const cls = (b.className||'').toString();
        const bg = (cls.match(/bg-\\[#[0-9A-Fa-f]{3,8}\\]/) || cls.match(/bg-[a-z]+-[0-9]+/) || [''])[0];
        return {t: (b.textContent||'').trim().slice(0,18), bg, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)};
      }).filter(b => b.t || b.bg);
      return JSON.stringify(out.slice(0, 40));
    })()`);
    console.log(label, s);
  };

  // click Sell tab
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().height < 40 && x.getBoundingClientRect().width < 150); if (b) b.click(); return !!b; })()`);
  await sleep(2500);
  await dump("SELL-TAB:");

  ws.close();
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
