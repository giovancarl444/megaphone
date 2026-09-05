// cdp-open-coin.mjs — kill hung pump.fun tabs, open ONE fresh tab on a coin page
const mint = process.argv[2] || "4pjvWo2TUzcdzFVn1j54kPw3uBtRM8nr6SKxyTiQ3xyn";
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
// close hung pump.fun pages
for (const t of list) {
  if (t.type === "page" && t.url.includes("pump.fun")) {
    try { await fetch(`http://127.0.0.1:9223/json/close/${t.id}`); console.log("closed:", t.url.slice(0, 60)); } catch {}
  }
}
await new Promise(r => setTimeout(r, 1500));
// open fresh tab on the coin page
const newTab = await (await fetch("http://127.0.0.1:9223/json/new?https://pump.fun/coin/" + mint, { method: "PUT" })).json();
console.log("opened tab:", newTab.id, newTab.url?.slice(0, 80));
// wait for load then ping
await new Promise(r => setTimeout(r, 8000));
const ws = new WebSocket(newTab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let replied = false;
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `JSON.stringify({title:document.title, bodyLen:document.body.innerText.length, url:location.href, buttons:[...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30)).filter(Boolean).slice(0,20)})`, returnByValue: true } }));
ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.id === 1) { console.log("RESULT:", m.result?.result?.value?.slice(0, 1500)); replied = true; process.exit(0); } } catch {} };
setTimeout(() => { if (!replied) { console.log("no reply after 8s (still loading)"); process.exit(1); } }, 9000);
