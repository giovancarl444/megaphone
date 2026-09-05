// console-errors.mjs — capture console errors on the pump.fun page
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("no pump.fun page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    const text = (m.params.args || []).map((a) => a.value || a.description || "").join(" ").slice(0, 200);
    errors.push(m.params.type + ": " + text);
  }
  if (m.method === "Runtime.exceptionThrown") {
    errors.push("EXC: " + JSON.stringify(m.params.exceptionDetails?.exception?.description || "").slice(0, 250));
  }
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
// reload to capture fresh errors
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 15000));
const res = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body ? document.body.innerText : '';
  return JSON.stringify({len: t.length, head: t.slice(0, 200).replace(/\\n+/g, ' | ')});
})()`, returnByValue: true });
console.log("PAGE:", res?.result?.value);
console.log("ERRORS CAPTURED:", errors.length);
for (const e of errors.slice(0, 12)) console.log("  " + e.slice(0, 220));
ws.close();
process.exit(0);
