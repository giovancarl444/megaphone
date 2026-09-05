// Navigate to a coin page with real session, find callout composer, capture the exact POST
const MINT = process.env.PF_MINT || "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const posts = [];
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") {
    const r = m.params.request;
    if (r.method === "POST") posts.push({url: r.url, headers: r.headers, postData: r.postData || null});
  }
};
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Page.navigate", {url: `https://pump.fun/coin/${MINT}`});
await new Promise(r => setTimeout(r, 12000));
// find callout composer: textarea + any callout button
const st = await send("Runtime.evaluate", {expression: `(() => {
  const body = document.body ? document.body.innerText : '';
  const ta = [...document.querySelectorAll('textarea, [contenteditable=true]')].map(t => ({tag: t.tagName, ph: t.placeholder || ''}));
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean).filter(t => /call|signal|post|send|share/i.test(t)).slice(0,15);
  return {bodyLen: body.length, bodyTail: body.slice(-400), ta, btns};
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
console.log("POSTS:", JSON.stringify(posts, null, 1));
ws.close();
