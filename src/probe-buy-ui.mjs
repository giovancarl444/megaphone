// probe-buy-ui.mjs — inspect pump.fun coin page DOM to find the buy input + button
const mint = process.argv[2] || "4pjvWo2TUzcdzFVn1j54kPw3uBtRM8nr6SKxyTiQ3xyn"; // BID by default
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("no pump.fun page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Page.enable");
await send("Runtime.enable");
// go to coin page
await send("Page.navigate", { url: `https://pump.fun/coin/${mint}` });
await new Promise((r) => setTimeout(r, 6000));
// dump clickable/input elements with text
const res = await send("Runtime.evaluate", { expression: `(() => {
  const out = [];
  // buttons
  document.querySelectorAll('button').forEach(b => {
    const t = (b.textContent || '').trim().replace(/\\s+/g,' ').slice(0,40);
    if (t) out.push('BTN[' + t + ']');
  });
  // inputs
  document.querySelectorAll('input').forEach(i => {
    out.push('INPUT[' + (i.placeholder || i.type || '?') + ']');
  });
  // common sell/buy tab text
  const body = document.body.innerText.slice(0, 200);
  return JSON.stringify({buttons: out.slice(0,25), bodyHead: body});
})()`, returnByValue: true });
console.log(JSON.stringify(res?.result?.value, null, 1)?.slice(0, 1800));
ws.close();
