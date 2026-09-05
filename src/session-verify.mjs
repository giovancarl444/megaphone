// session-verify.mjs — check logged-in state on the pump.fun tab + grab auth token
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
if (!page) { console.log("no pump.fun tab"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Network.enable");
await send("Runtime.enable");
// read cookies for pump.fun
const cookies = await send("Network.getAllCookies", {});
const pfCookies = (cookies?.cookies || []).filter((c) => c.domain.includes("pump.fun"));
const auth = pfCookies.find((c) => c.name === "auth_token");
console.log("pump.fun cookies:", pfCookies.map((c) => c.name).join(", "));
console.log("auth_token:", auth ? auth.value.slice(0, 30) + "..." + ` (len ${auth.value.length})` : "MISSING");
// check localStorage token too
const ls = await send("Runtime.evaluate", { expression: `(() => { try { return JSON.stringify({token: !!localStorage.getItem('token'), jwt: !!localStorage.getItem('jwt'), keys: Object.keys(localStorage).filter(k=>k.toLowerCase().includes('token')||k.toLowerCase().includes('auth')||k.toLowerCase().includes('privy'))}); } catch(e){ return 'err'; } })()`, returnByValue: true });
console.log("localStorage:", ls?.result?.value);
// page state
const st = await send("Runtime.evaluate", { expression: `(() => { const t = document.body ? document.body.innerText : ''; return JSON.stringify({len: t.length, hasSignIn: t.includes('Sign in'), head: t.slice(0,120).replace(/\\n+/g,' | ')}); })()`, returnByValue: true });
console.log("page:", st?.result?.value);
ws.close();
process.exit(0);
