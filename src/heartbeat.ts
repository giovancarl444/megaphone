/**
 * health.ts — twice-daily watcher health report + auto-restart.
 * Run via Hermes cron at 08:00 + 20:00 local time.
 *
 * Reports to CALLOUT_CHAT:
 *   - watcher alive? (recency of supervisor .daemon.out.log writes)
 *   - book counts: OPEN / WIN / STOP / HISSELL / VOID (from cupsey-trades.json)
 *   - age of last signal (newest trade openedAt)
 * If watcher is dead at heartbeat time -> restart supervisor, say so explicitly.
 */
import { readFileSync, existsSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { CALLOUT_CHAT } from "./config";

const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const ROOT = path.join(DATA_DIR, "..");
const LOG = path.join(ROOT, ".daemon.out.log");
const WATCH_LOG = path.join(ROOT, ".watch.out.log");
const CUPSEY_LOG = path.join(ROOT, ".cupsey.out.log");
const SNIPER_LOG = path.join(ROOT, ".sniper.out.log");
const TRADE_FILE = path.join(DATA_DIR, "cupsey-trades.json");
const SNIPE_FILE = path.join(DATA_DIR, "sniper-trades.json");
const CHAT = CALLOUT_CHAT;
const ALIVE_WINDOW_MS = 5 * 60 * 1000;

type CupseyOutcome = "OPEN" | "WIN" | "STOP" | "HISSELL" | "VOID";
type SniperOutcome = "OPEN" | "WIN" | "STOP" | "COPYEXIT";
interface Trade { outcome?: string; openedAt?: number; }

function send(text: string) {
  const targets = [CHAT, "telegram:1915394365"];
  for (const target of targets) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tmp = path.join(DATA_DIR, `hb-${Date.now()}-${attempt}.txt`);
      try { writeFileSync(tmp, text, "utf8"); } catch { continue; }
      try {
        execSync(`hermes send -t ${target} -f "${tmp}"`, { stdio: "ignore", timeout: 12000 });
        try { unlinkSync(tmp); } catch {}
        return;
      } catch {
        try { unlinkSync(tmp); } catch {}
        if (attempt < 2) { try { execSync("ping -n 2 127.0.0.1 >nul 2>&1"); } catch {} }
      }
    }
  }
  console.error("[health] send failed after retries (all targets)");
}

function watcherAlive(): boolean {
  // alive if any child log was written in the window (supervisor + children)
  const logs = [LOG, WATCH_LOG, CUPSEY_LOG, SNIPER_LOG];
  for (const l of logs) {
    if (!existsSync(l)) continue;
    try { if (Date.now() - statSync(l).mtimeMs < ALIVE_WINDOW_MS) return true; } catch {}
  }
  return false;
}

function countOutcomes(file: string, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = 0;
  if (!existsSync(file)) return out;
  try {
    const trades = JSON.parse(readFileSync(file, "utf8")) as Trade[];
    for (const t of trades) if (t.outcome && out[t.outcome] !== undefined) out[t.outcome]++;
  } catch {}
  return out;
}

function bookCounts(): { cupsey: Record<string, number>; sniper: Record<string, number> } {
  return {
    cupsey: countOutcomes(TRADE_FILE, ["OPEN", "WIN", "STOP", "HISSELL", "VOID"]),
    sniper: countOutcomes(SNIPE_FILE, ["OPEN", "WIN", "STOP", "COPYEXIT"]),
  };
}

function lastSignalAgeMs(): number | null {
  const files = [TRADE_FILE, SNIPE_FILE].filter((f) => existsSync(f));
  const times: number[] = [];
  for (const f of files) {
    try {
      const trades = JSON.parse(readFileSync(f, "utf8")) as Trade[];
      for (const t of trades) if (t.openedAt) times.push(t.openedAt);
    } catch {}
  }
  if (!times.length) return null;
  return Date.now() - Math.max(...times);
}

function restartSupervisor() {
  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const sup = path.join(ROOT, "src", "supervisor.ts");
  spawn(process.execPath, [tsx, sup], { cwd: ROOT, detached: true, stdio: "ignore" }).unref();
}

function fmtAge(ms: number | null): string {
  if (ms == null) return "never";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

async function main() {
  const alive = watcherAlive();
  const books = bookCounts();
  const age = lastSignalAgeMs();
  const now = new Date().toLocaleString("en-GB", { timeZone: "Europe/Berlin" });
  const c = books.cupsey, s = books.sniper;
  let msg =
    `💓 HEARTBEAT ${now}\n` +
    `watcher: ${alive ? "ALIVE ✅" : "DEAD ❌ — restarting"}\n` +
    `cupsey book OPEN/WIN/STOP/HISSELL/VOID: ${c.OPEN}/${c.WIN}/${c.STOP}/${c.HISSELL}/${c.VOID}\n` +
    `sniper book OPEN/WIN/STOP/COPYEXIT: ${s.OPEN}/${s.WIN}/${s.STOP}/${s.COPYEXIT}\n` +
    `last signal: ${fmtAge(age)} ago`;
  if (!alive) { restartSupervisor(); msg += `\n↻ supervisor restarted`; }
  send(msg);
  console.log(msg.replace(/\n/g, " | "));
}
main().catch((e) => { console.error(e); process.exit(1); });
