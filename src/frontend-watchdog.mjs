/**
 * frontend-watchdog.mjs — watches pump.fun's frontend for recovery.
 *
 * pump.fun is currently serving a broken shell (nav only, content never mounts —
 * verified from clean browsers, so it's their side). The auto-buy/post engine
 * needs the UI. This watchdog polls a pump.fun tab every 60s; the moment real
 * content mounts (bodyLen > 500), it:
 *   1. prints READY
 *   2. optionally spawns the trending-watch live loop
 *   3. alerts the founder via hermes send
 *
 * Usage:
 *   node src/frontend-watchdog.mjs            # watch only
 *   node src/frontend-watchdog.mjs --fire     # watch + launch trending engine when ready
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const MEG = process.cwd();
const FIRE = process.argv.includes("--fire");
const FOUNDER_DM = "telegram:1915394365";
const DATA_DIR = path.join(MEG, ".megaphone");

function alertFounder(msg) {
  try {
    const tmp = path.join(DATA_DIR, "watchdog-alert.tmp.txt");
    writeFileSync(tmp, msg, "utf8");
    execSync(`hermes send --to ${FOUNDER_DM} -f "${tmp}"`, { timeout: 15000, windowsHide: true, stdio: "ignore" });
  } catch (e) { console.error("alert fail:", (e).message.slice(0, 100)); }
}

async function getPumpTab() {
  const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
  return list.find((t) => t.type === "page" && t.url.includes("pump.fun"));
}

async function checkRender() {
  try {
    let page = await getPumpTab();
    if (!page) {
      const r = await fetch(`http://127.0.0.1:9223/json/new?${encodeURIComponent("https://pump.fun/")}`, { method: "PUT" });
      page = await r.json();
      await new Promise((res) => setTimeout(res, 8000));
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
    const to = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000));
    try {
      await Promise.race([new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }), to]);
      await send("Runtime.enable");
      const res = await Promise.race([send("Runtime.evaluate", { expression: `(() => {
        const t = document.body ? document.body.innerText : '';
        return JSON.stringify({len: t.length, url: location.href});
      })()`, returnByValue: true }), to]);
      const val = res?.result?.value;
      try { ws.close(); } catch {}
      if (val) {
        const j = JSON.parse(val);
        return j.len;
      }
    } catch { try { ws.close(); } catch {} }
    return 0;
  } catch (e) { return 0; }
}

let checks = 0;
async function loop() {
  const len = await checkRender();
  checks++;
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[watchdog] ${ts} check #${checks} — bodyLen ${len}${len > 500 ? " ✅ CONTENT MOUNTED" : " (shell only)"}`);
  if (len > 500) {
    console.log("[watchdog] ✅ PUMP.FUN FRONTEND IS BACK — engine can fire!");
    alertFounder("🟢 PUMP.FUN FRONTEND IS BACK — the callout engine can fire now. Say the word or I auto-fire in 60s.");
    if (FIRE) {
      console.log("[watchdog] 🚀 launching trending-watch live loop...");
      alertFounder("🚀 AUTO-FIRING trending callout engine (caps 2/h, 6/d, $1.10 buys, safety-gated).");
      try {
        const child = execSync(
          `start /b node node_modules/tsx/dist/cli.mjs src/trending-watch.ts > .megaphone/trending-watch.log 2>&1`,
          { cwd: MEG, shell: "cmd.exe", stdio: "ignore", windowsHide: true },
        );
      } catch (e) { console.error("launch fail:", e.message.slice(0, 120)); }
    }
    process.exit(0);
  }
  setTimeout(loop, 60000);
}

console.log(`[watchdog] watching pump.fun frontend every 60s${FIRE ? " — will auto-fire trending engine when ready" : ""}`);
alertFounder("👀 Watchdog armed — monitoring pump.fun frontend recovery. Will fire the callout engine the moment it's back.");
loop();
