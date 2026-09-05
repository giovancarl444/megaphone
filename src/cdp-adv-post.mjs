// Test /callout/create on advanced-api-v2 host with page auth
const MINT = process.env.PF_MINT || "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const res = await send("Runtime.evaluate", {expression: `(async () => {
  const out = [];
  const base = 'https://advanced-api-v2.pump.fun';
  const tries = [
    ['GET', base + '/callout/eligibility?mint=${MINT}', null],
    ['POST', base + '/callout/create', {mint: '${MINT}', text: 'test callout from engine'}],
    ['POST', base + '/callouts', {mint: '${MINT}', text: 'test callout from engine'}],
  ];
  for (const [m, url, body] of tries) {
    try {
      const r = await fetch(url, {method: m, credentials: 'include', headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
      out.push({m, url: url.replace(base,''), status: r.status, body: (await r.text()).slice(0, 200)});
    } catch (e) { out.push({m, url: url.replace(base,''), error: e.message}); }
  }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log(JSON.stringify(res.result.value, null, 1));
ws.close();
