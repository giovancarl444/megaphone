// Navigate to a coin page and find the callout composer UI
const MINT = process.env.PF_MINT || "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", {url: `https://pump.fun/coin/${MINT}`});
await new Promise(r => setTimeout(r, 8000));
const st = await send("Runtime.evaluate", {expression: `(() => {
  const btns = [...document.querySelectorAll('button, [role=button]')].map(b => (b.innerText||b.getAttribute('aria-label')||'').trim()).filter(Boolean).filter(t => /call|signal|post|repl/i.test(t)).slice(0,15);
  return {url: location.href, title: document.title, callBtns: btns, bodyHead: document.body.innerText.slice(0,150)};
})()`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
