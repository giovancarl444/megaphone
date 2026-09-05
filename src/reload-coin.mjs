// reload-coin.mjs — hard reload the coin page and wait, check content mounts
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
console.log("reloaded, waiting 18s...");
await new Promise((r) => setTimeout(r, 18000));
const res = await send("Runtime.evaluate", {
  expression: `(() => {
    const t = document.body ? document.body.innerText : '';
    return JSON.stringify({ len: t.length, has3123: t.includes('3123'), hasBuyPanel: t.includes('SOL') && /[0-9]+\\.[0-9]+ SOL/.test(t), head: t.slice(0, 200).replace(/\\n+/g, ' | ') });
  })()`, returnByValue: true,
});
console.log("AFTER RELOAD:", res?.result?.value);
ws.close();
process.exit(0);
