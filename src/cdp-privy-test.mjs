// Extract full Privy access token + test as Bearer on callout endpoints
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page") || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
const tok = await send("Runtime.evaluate", {expression: `(() => {
  const raw = localStorage.getItem('privy:token');
  return raw ? raw.replace(/^"/, '').replace(/"$/, '') : null;
})()`, returnByValue: true});
const TOKEN = tok.result.value;
console.log("privy token len:", TOKEN ? TOKEN.length : 'null');
if (!TOKEN) process.exit(0);
// test on frontend-api-v3 callout endpoints
const MINT = "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const tries = [
  ['GET', `https://frontend-api-v3.pump.fun/callout/eligibility?mint=${MINT}`],
  ['POST', `https://frontend-api-v3.pump.fun/callout/create`],
];
for (const [m, url] of tries) {
  try {
    const r = await fetch(url, {method: m, headers: {Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Origin: 'https://pump.fun'}, body: m === 'POST' ? JSON.stringify({mint: MINT, text: 'test'}) : undefined});
    console.log(m, url.replace('https://frontend-api-v3.pump.fun',''), '->', r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.log(m, 'ERR', e.message); }
}
ws.close();
