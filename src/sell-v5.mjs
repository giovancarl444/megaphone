// sell-v5.mjs — real clicks + catch popup/iframe confirm; poll for target changes
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

  const tab = await btnXY(`[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Sell' && x.getBoundingClientRect().height < 40 && x.getBoundingClientRect().width < 150)`);
  console.log("tab:", tab);
  if (tab) await clickXY(tab.x, tab.y);
  await sleep(2500);

  // watch for new targets BEFORE clicking
  const targetsBefore = new Set((await (await fetch("http://127.0.0.1:9223/json/list")).json()).map(t => t.id));

  const pct = await btnXY(`[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '100%' && x.getBoundingClientRect().width > 50)`);
  console.log("100%:", pct);
  if (pct) await clickXY(pct.x, pct.y);
  await sleep(3000);

  // what changed? CTA text?
  const after = await ev(`(() => {
    const green = [...document.querySelectorAll('button')].find(x => { const cls = (x.className||'').toString(); const r = x.getBoundingClientRect(); return cls.includes('1FD978') && r.width > 150 && r.height >= 30; });
    const all = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 100 && b.getBoundingClientRect().y > 300 && b.getBoundingClientRect().y < 700).map(b => (b.textContent||'').trim().slice(0,30));
    return JSON.stringify({green: green ? green.textContent.trim().slice(0,30) : null, all});
  })()`);
  console.log("after 100%:", after);

  // click green CTA (whatever label now)
  const cta = await btnXY(`[...document.querySelectorAll('button')].find(x => { const cls = (x.className||'').toString(); const r = x.getBoundingClientRect(); return cls.includes('1FD978') && r.width > 150 && r.height >= 30; })`);
  console.log("CTA:", cta);
  if (cta) await clickXY(cta.x, cta.y);
  await sleep(6000);

  // new targets?
  const targetsNow = (await (await fetch("http://127.0.0.1:9223/json/list")).json()).filter(t => !targetsBefore.has(t.id) && t.type === "page");
  console.log("NEW TARGETS:", targetsNow.map(t => t.url.slice(0, 100)).join(" | ") || "none");

  // iframe check
  const frames = await ev(`(() => {
    return [...document.querySelectorAll('iframe')].map(f => ({src: (f.src||'').slice(0,80), w: Math.round(f.getBoundingClientRect().width), h: Math.round(f.getBoundingClientRect().height), vis: f.getBoundingClientRect().width > 50}));
  })()`);
  console.log("iframes:", JSON.stringify(frames));

  // body text tail for confirm buttons
  const bodyTail = await ev(`(() => document.body.innerText.slice(-600).replace(/\\n+/g,' | '))()`);
  console.log("bodyTail:", bodyTail.slice(-400));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
