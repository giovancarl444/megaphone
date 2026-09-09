// pos-raw.mjs — raw text around position card
const mint = process.argv[2];
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function main() {
  const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
  let page = list.find((t) => t.type === "page" && t.url.includes(mint)) || list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; const to = setTimeout(() => { pend.delete(i); rej(new Error(`timeout ${m}`)); }, 25000); pend.set(i, (v) => { clearTimeout(to); res(v); }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } } catch {} };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send("Page.enable"); await send("Runtime.enable");
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` });
  await sleep(14000);
  const s = await ev(`(() => {
    const btns = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(t => /position|profit|\\$|%|hold/i.test(t) && t.length < 120);
    return JSON.stringify(btns.slice(0, 10));
  })()`);
  console.log(mint.slice(0,8), s);
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
