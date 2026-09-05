// profile-analysis2.mjs — use the OPEN profile page tab to read callouts from the DOM/API
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun/profile"));
if (!page) { console.log("no profile page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {
  expression: `(async () => {
    const uid = '4ac11d85-afce-47cb-9c81-8345400351b4';
    try {
      const r = await fetch('https://frontend-api-v3.pump.fun/callout/list/' + uid + '?sortBy=TIMESTAMP&sortOrder=desc&limit=200', { credentials: 'include' });
      if (!r.ok) return JSON.stringify({error: r.status, body: (await r.text()).slice(0,200)});
      const j = await r.json();
      const out = (j.callouts || j.data || []).map(c => ({
        symbol: c.symbol || c.coinSymbol || (c.coin && c.coin.symbol) || null,
        mc: c.marketCap || c.mc || 0,
        multiple: c.multiple ?? null,
        maxMult: c.maxMultiplier ?? null,
        views: c.viewCount ?? 0,
        likes: c.likeCount ?? 0,
        thesis: c.thesis || c.text || '',
        createdAt: c.createdAt || 0
      }));
      return JSON.stringify({count: out.length, calls: out});
    } catch(e) { return JSON.stringify({error: e.message}); }
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log(res?.result?.value || "no result");
ws.close();
process.exit(0);
