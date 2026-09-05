// Click age-gate continue, then dump state
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("pump.fun")) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params={}) { return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send("Runtime.enable");
// click the continue button (age gate)
const click = await send("Runtime.evaluate", {expression: `(() => { const btns = [...document.querySelectorAll('button')]; const b = btns.find(x => /continue/i.test(x.innerText)); if (b) { b.click(); return 'clicked continue'; } return 'no continue btn: ' + btns.map(x=>x.innerText).slice(0,10).join('|'); })()`, returnByValue: true});
console.log(click.result.value);
await new Promise(r => setTimeout(r, 4000));
const st = await send("Runtime.evaluate", {expression: `({title: document.title, url: location.href, hasWallet: !!(window.solana || window.phantom || window.phantom?.solana), cookies: document.cookie.slice(0, 200)})`, returnByValue: true});
console.log(JSON.stringify(st.result.value, null, 1));
ws.close();
