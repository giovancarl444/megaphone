// probe-pumpfun-trade.mjs — find the authenticated trade endpoint in the browser session
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
console.log("page:", page?.url?.slice(0, 100));
if (!page) { console.log("no pump.fun page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {
  expression: `(async () => {
    const probes = ['/trade','/trades','/swap','/rpc','/trade/local','/trade/lightning'];
    const out = [];
    for (const p of probes) {
      try {
        const r = await fetch('https://frontend-api-v3.pump.fun' + p, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}', credentials:'include' });
        out.push(p + ' -> ' + r.status + ' ' + (await r.text()).slice(0,60));
      } catch(e) { out.push(p + ' ERR'); }
    }
    return out.join('\\n');
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log(res?.result?.value || "no result");
ws.close();
