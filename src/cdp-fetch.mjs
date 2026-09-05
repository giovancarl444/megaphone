// Call the callout POST from INSIDE the page context (same-origin, same auth as the real frontend)
const MINT = process.env.PF_MINT || "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const requests = [];
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") requests.push({url: m.params.request.url, method: m.params.request.method, headers: m.params.request.headers});
};
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
// Try the fetch from page context — this uses the page's cookies + any interception
const res = await send("Runtime.evaluate", {expression: `(async () => {
  const tries = [
    ['/api/v1/communities/${MINT}/callouts', {text: 'genius test'}],
    ['/callouts/${MINT}', {text: 'genius test'}],
  ];
  const out = [];
  for (const [path, body] of tries) {
    try {
      const r = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      out.push({path, status: r.status, body: (await r.text()).slice(0,200)});
    } catch (e) { out.push({path, error: e.message}); }
  }
  return out;
})()`, awaitPromise: true, returnByValue: true});
console.log("RESPONSES:", JSON.stringify(res.result.value, null, 1));
await new Promise(r => setTimeout(r, 1000));
console.log("REQUESTS CAPTURED:", JSON.stringify(requests.filter(r => r.method === 'POST').slice(-4), null, 1));
ws.close();
