// avatar-owner.mjs — find the logged-in user's avatar menu link (own profile = truth)
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
// Look for the avatar in the top nav — usually an <a href="/profile/..."> or img near the search bar
const res = await send("Runtime.evaluate", {
  expression: `(() => {
    // top nav avatar: img with pumpatar inside a link, near the top of the page
    const imgs = [...document.querySelectorAll('img[src*="pumpatar"]')];
    const top = imgs.filter(i => { const r = i.getBoundingClientRect(); return r.top < 80; });
    const links = top.map(i => { let a = i.closest('a'); return a ? a.getAttribute('href') : null; }).filter(Boolean);
    // also check the header nav area for profile link
    const allA = [...document.querySelectorAll('a[href*="/profile/"]')].map(a => a.getAttribute('href'));
    const uniq = [...new Set(allA)].slice(0, 5);
    return JSON.stringify({ topAvatarLinks: [...new Set(links)].slice(0, 3), allProfileLinks: uniq });
  })()`, returnByValue: true,
});
console.log("OWN AVATAR:", res?.result?.value);
ws.close();
process.exit(0);
