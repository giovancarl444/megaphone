// own-profile-check.mjs — navigate to BT7bQZmX profile, check if UI treats it as OWN
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
// go to the profile page
await send("Page.navigate", { url: "https://pump.fun/profile/BT7bQZmXqk9ZedacpdWLceEeWemCU6P59zwmBC8bNUUB" });
await new Promise((r) => setTimeout(r, 12000));
const res = await send("Runtime.evaluate", {
  expression: `(() => {
    const t = document.body ? document.body.innerText : '';
    return JSON.stringify({
      len: t.length,
      hasFollow: /follow/i.test(t) && !/following\\s*$/.test(t),
      hasEditProfile: t.includes('Edit profile') || t.includes('Edit Profile'),
      hasCalloutBtn: t.includes('Call out') || t.includes('Callout'),
      hasShareProfile: t.includes('Share profile'),
      username: (t.match(/@?[A-Za-z0-9_]{3,20}/) || [''])[0],
      followers: (t.match(/[0-9,]+\\s*followers/) || [''])[0],
      head: t.slice(0, 250).replace(/\\n+/g, ' | ')
    });
  })()`, returnByValue: true,
});
console.log("PROFILE VIEW:", res?.result?.value);
ws.close();
process.exit(0);
