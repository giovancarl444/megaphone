// Click the actual Callout button on coin page, capture ALL network (this reveals the real API)
const MINT = process.env.PF_MINT || "6kwFS2aTfezFMxLBRQRVgGRx6cb5VbR1FDg9Eixrpump";
const PORT = "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const reqs = [];
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") {
    const r = m.params.request;
    if (/callout|repl|signal/i.test(r.url)) reqs.push({m: r.method, url: r.url.slice(0,150), body: r.postData || null});
  }
};
await new Promise(r => ws.onopen = r);
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
// scroll + find callout button (visible one on coin page)
const cl = await send("Runtime.evaluate", {expression: `(() => {
  const all = [...document.querySelectorAll('button, [role=button], a')];
  const hits = all.filter(e => {
    const t = (e.innerText || e.getAttribute('aria-label') || '').trim();
    return /callout/i.test(t) && e.offsetParent !== null;
  }).map(e => ({tag: e.tagName, text: (e.innerText||'').trim().slice(0,50)}));
  // click the first visible one
  const b = all.find(e => /callout/i.test((e.innerText||e.getAttribute('aria-label')||'').trim()) && e.offsetParent !== null);
  if (b) { b.click(); return {clicked: b.innerText, all: hits.slice(0,5)}; }
  return {clicked: null, all: hits.slice(0,5)};
})()`, returnByValue: true});
console.log("CLICK:", JSON.stringify(cl.result.value, null, 1));
await new Promise(r => setTimeout(r, 4000));
// dump any dialog/composer that opened
const st = await send("Runtime.evaluate", {expression: `(() => {
  const dlg = [...document.querySelectorAll('[role=dialog], [class*=Dialog], [class*=dialog]')].filter(d => d.offsetParent !== null);
  const ta = [...document.querySelectorAll('textarea, [contenteditable=true]')].filter(t => t.offsetParent !== null).length;
  return {dialogs: dlg.length, textareas: ta, body: document.body.innerText.slice(-300)};
})()`, returnByValue: true});
console.log("STATE:", JSON.stringify(st.result.value, null, 1));
console.log("REQS:", JSON.stringify(reqs, null, 1));
ws.close();
