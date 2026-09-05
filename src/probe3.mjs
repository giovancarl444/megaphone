// probe3.mjs — navigate to coin page, wait, dump full interactive state
const mint = process.argv[2] || "4pjvWo2TUzcdzFVn1j54kPw3uBtRM8nr6SKxyTiQ3xyn";
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Page.enable"); await send("Runtime.enable");
console.log("navigating to coin page...");
await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` });
await new Promise((r) => setTimeout(r, 9000));
const res = await send("Runtime.evaluate", { expression: `JSON.stringify({
  url: location.href,
  title: document.title,
  buttons: [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim().replace(/\\s+/g,' ').slice(0,35)).filter(Boolean).slice(0,25),
  inputs: [...document.querySelectorAll('input')].map(i => ({ph:i.placeholder||'', type:i.type||'', val:(i.value||'').slice(0,10)})).slice(0,10),
  hasUSD: [...document.querySelectorAll('*')].some(e => e.children.length===0 && /\\$1|\$5|\$10|50%|25%/.test((e.textContent||'').trim())),
  bodyLen: document.body.innerText.length
})`, returnByValue: true });
console.log(res?.result?.value || "NO RESULT — page may be blank/shell");
ws.close();
