// iframe-content.mjs — what's inside the blob iframe and the Privy iframe?
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("/coin/"));
if (!page) { console.log("no coin tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

// list frames via CDP
const tree = await send("Page.getFrameTree", {});
function walk(f, depth = 0) {
  console.log("  ".repeat(depth) + "FRAME:", (f.frame.url || "").slice(0, 90), "id:", f.frame.id.slice(0, 12));
  for (const c of f.childFrames || []) walk(c, depth + 1);
}
walk(tree.frameTree);

// inspect blob iframe content (same-origin blob should be accessible)
console.log("blob content:", await ev(`(() => {
  const f = [...document.querySelectorAll('iframe')].find(x => (x.src||'').startsWith('blob:'));
  if (!f || !f.contentDocument) return 'no-access';
  const d = f.contentDocument;
  const t = d.body ? d.body.innerText : '';
  return JSON.stringify({len: t.length, head: t.slice(0, 200).replace(/\\n+/g,' | ')});
})()`));
ws.close();
process.exit(0);
