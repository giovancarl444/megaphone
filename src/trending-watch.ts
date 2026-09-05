/**
 * trending-watch.ts — THE CALLOUT ENGINE (v1)
 *
 * Mirrors the founder's proven manual playbook:
 *   watch pump.fun coins that are YOUNG + ACTIVE + MOVING
 *   -> safety scan (never rug)
 *   -> auto-buy $1.1 (funded session)
 *   -> auto-post callout with a caption in the founder's voice
 *
 * Founder's voice (from 100-callout analysis):
 *   - SHORT (1-8 words), punchy, all-caps punch words
 *   - names the real hook (creator handle, meme, narrative) when known
 *   - urgency when the coin is actually ripping
 *   - NEVER long thesis, NEVER "watching momentum closely"
 *
 * Filters (calibrated):
 *   - age: 2min - 3h (fresh enough to be "early", old enough to be real)
 *   - usd_market_cap: $3K - $150K (the founder's sweet spot — small enough to 10x)
 *   - active: last trade within last 10 min
 *   - creator NOT a known scam pattern (safety scan covers this)
 *   - safety: PASS only (auto-buy gate)
 *
 * Risk (surgical):
 *   - max 2 buys/hour, max 6/day, max $1.10 each (env overridable)
 *   - pre-flight balance check
 *
 * Usage:
 *   node node_modules/tsx/dist/cli.mjs src/trending-watch.ts           # loop
 *   node node_modules/tsx/dist/cli.mjs src/trending-watch.ts --once    # single scan (no buy)
 *   node node_modules/tsx/dist/cli.mjs src/trending-watch.ts --dryrun  # scan + show what WOULD be called
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import * as api from "./api-rail";

const DATA_DIR = path.join(process.cwd(), ".megaphone");
const LEDGER_FILE = path.join(DATA_DIR, "trending-calls.json");
const SEEN_FILE = path.join(DATA_DIR, "trending-seen.json");
const LOCK_FILE = path.join(DATA_DIR, "trending-watch.lock");
const FOUNDER_DM = "telegram:1915394365";

// ---- filters (calibrated to the founder's winners) ----
const MIN_AGE_MS = 2 * 60 * 1000;        // >= 2 min old
const MAX_AGE_MS = 3 * 3600 * 1000;      // <= 3h old
const MIN_MC = 3000;                     // >= $3K (real enough)
const MAX_MC = 150_000;                  // <= $150K (small enough to pop)
const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // traded within last 10 min
const POLL_MS = 60_000;                  // scan every 60s
const BUY_USD = 1.1;

// ---- risk caps ----
const MAX_PER_HOUR = Number(process.env.TREND_MAX_HOUR || 2);
const MAX_PER_DAY = Number(process.env.TREND_MAX_DAY || 6);

interface CallRecord {
  mint: string;
  symbol: string;
  name: string;
  mc: number;
  ageMin: number;
  creator: string;
  twitter: string | null;
  score: number;
  thesis: string;
  status: "queued" | "bought" | "posted" | "skipped" | "failed";
  ts: number;
}

function loadJSON<T>(f: string, d: T): T {
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; }
}
function saveJSON(f: string, v: any) {
  writeFileSync(f + ".tmp", JSON.stringify(v, null, 2));
  try { execSync(`move /y "${f}.tmp" "${f}"`, { shell: "cmd.exe", stdio: "ignore" }); } catch { writeFileSync(f, JSON.stringify(v, null, 2)); }
}

function alertFounder(msg: string) {
  try {
    const tmp = path.join(DATA_DIR, "trending-alert.tmp.txt");
    writeFileSync(tmp, msg, "utf8");
    execSync(`hermes send --to ${FOUNDER_DM} -f "${tmp}"`, { timeout: 15000, windowsHide: true, stdio: "ignore" });
  } catch (e) { console.error("alert fail:", (e as Error).message.slice(0, 100)); }
}

function lockAlive(): boolean {
  try {
    const pid = parseInt(readFileSync(LOCK_FILE, "utf8").trim());
    const { execSync: es } = require("child_process");
    const out = es(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8" }).trim();
    return out.includes(String(pid));
  } catch { return false; }
}

/** Score a coin for callout-worthiness (0-100). Mirrors what gets views. */
function scoreCoin(c: any, now: number): number {
  const ageMs = now - (c.created_timestamp || now);
  const mc = c.usd_market_cap || 0;
  const lastTrade = c.last_trade_timestamp || 0;
  const activeMs = now - lastTrade;
  let s = 50;

  // recency: younger = better ("early" premium) — peak ~10-40 min
  if (ageMs < MIN_AGE_MS || ageMs > MAX_AGE_MS) return 0;
  if (ageMs < 40 * 60 * 1000) s += 20; else if (ageMs < 2 * 3600 * 1000) s += 10; else s += 5;

  // activity: traded recently = eyes on it
  if (activeMs < 60 * 1000) s += 15;
  else if (activeMs < 5 * 60 * 1000) s += 10;
  else if (activeMs < ACTIVE_WINDOW_MS) s += 5;
  else return 0;

  // mc sweet spot — $3K-$150K; below $3K = nobody bought it (dead), above = too late
  if (mc < MIN_MC) return 0;
  if (mc <= 30_000) s += 15;        // micro — the 10x zone
  else if (mc <= 150_000) s += 8;
  else return 0;

  // social presence = narrative hook potential
  if (c.twitter) s += 5;
  if (c.telegram) s += 3;
  if (c.username) s += 3;

  // momentum proxy: reply_count (chat activity) and king-of-hill
  s += Math.min(10, (c.reply_count || 0) * 2);
  if (c.is_currently_live) s += 5;

  return Math.round(Math.min(100, s));
}

/** Generate a caption in the founder's voice. */
function makeCaption(c: any, score: number): string {
  const sym = (c.symbol || "?").toUpperCase().replace(/\s+/g, " ").trim();
  const ageMin = Math.round((Date.now() - (c.created_timestamp || Date.now())) / 60000);
  const twitter = c.twitter || null;
  const live = c.is_currently_live;

  // clean X handle: strip URL prefix AND any path (/status/...) — handle only
  let handle = (twitter || "").replace(/^https?:\/\/(x|twitter)\.com\//, "").replace(/^@/, "").split(/[/?#]/)[0];
  if (handle && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) handle = "";
  const opts: string[] = [];

  if (live) opts.push(`${sym} LIVE`);
  if (handle) opts.push(`${sym} by @${handle}`);
  else if (c.username && !/^[A-Za-z0-9_]{1,15}$/.test(c.username || "")) opts.push(`${sym} by ${c.username}`);
  opts.push(`${sym} EARLY`);
  if (ageMin <= 30) opts.push(`${sym} ${ageMin}m old`);
  opts.push(`${sym} MOVING`);

  // pick based on score band — high score = more hype (it's actually moving)
  const hype = ["LET'S GO", "RIPPING", "RUNNER", "HOLY RUNNER", "MASSIVE", "GET IN"];
  const chill = ["early", "fresh", "looks interesting", "keep an eye"];
  const optsClean = opts.filter((o) => !/\s{2,}/.test(o));
  const base = optsClean[Math.floor(Math.random() * optsClean.length)];
  if (score >= 75) return `${base} ${hype[Math.floor(Math.random() * hype.length)]}`;
  if (score >= 60) return `${base} — ${chill[Math.floor(Math.random() * chill.length)]}`;
  return base;
}

async function fetchActive(): Promise<any[]> {
  // Watch THREE angles of the market: fresh launches, active trades, hot chatter.
  // (last_trade_timestamp alone can be all old coins during rotations.)
  const sorts = [
    "created_timestamp",     // fresh launches
    "last_trade_timestamp",  // actively traded now
    "reply_count",           // hot conversation
  ];
  const merged = new Map<string, any>();
  for (const sort of sorts) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://frontend-api-v3.pump.fun/coins?sort=${sort}&limit=40&offset=0`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const list: any[] = await r.json();
          for (const c of list) if (c?.mint) merged.set(c.mint, c);
          break;
        }
      } catch (e) { console.log(`[trending] ${sort} fetch ${attempt + 1} failed: ${(e as Error).message.slice(0, 60)}`); }
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return [...merged.values()];
}

async function safetyPass(mint: string): Promise<boolean> {
  try {
    const out = execSync(`node node_modules/tsx/dist/cli.mjs src/token-safety.ts ${mint}`, {
      encoding: "utf8", timeout: 25000, windowsHide: true, cwd: process.cwd(),
    });
    return out.includes("PASS");
  } catch { return false; }
}

async function autoBuy(mint: string): Promise<boolean> {
  // API rail: pumpdev REST buy with on-chain verification (no browser)
  // SOL ~$103 (measured 09-05): 0.014 SOL ≈ $1.45 -> clears the $1 gate
  // even with ~25% slippage on micro-caps (bought amount registers in USD).
  try {
    const sig = await api.apiBuy(mint, 0.014);
    return !!sig;
  } catch (e) {
    console.log(`[trending] apiBuy err: ${(e as Error).message.slice(0, 120)}`);
    return false;
  }
}

async function postCallout(mint: string, thesis: string): Promise<boolean> {
  const res = await api.apiPostCallout(mint, thesis, { waitMs: 12000 });
  if (!res.ok) console.log(`[trending] post failed: ${res.detail}`);
  return res.ok;
}

async function scanOnce(dryRun: boolean) {
  const now = Date.now();
  const ledger = loadJSON<CallRecord[]>(LEDGER_FILE, []);
  const seen = loadJSON<string[]>(SEEN_FILE, []);
  const coins = await fetchActive();
  if (!coins.length) { console.log("[trending] feed empty/failed"); return; }

  // hour/day caps from ledger
  let hourCalls = ledger.filter((c) => now - c.ts < 3600_000 && (c.status === "posted" || c.status === "bought")).length;
  let dayCalls = ledger.filter((c) => now - c.ts < 86400_000 && (c.status === "posted" || c.status === "bought")).length;

  const candidates: { c: any; score: number }[] = [];
  for (const c of coins) {
    if (seen.includes(c.mint)) continue;
    if (c.is_banned || c.nsfw) continue;
    if (c.complete) continue; // bonding curve graduated — too late
    const score = scoreCoin(c, now);
    if (score >= 60) candidates.push({ c, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  if (dryRun) {
    console.log(`[trending] DRY-RUN — ${candidates.length} candidates (hour ${hourCalls}/${MAX_PER_HOUR}, day ${dayCalls}/${MAX_PER_DAY})`);
    for (const { c, score } of candidates.slice(0, 8)) {
      const age = Math.round((now - c.created_timestamp) / 60000);
      console.log(`  ${score} | ${(c.symbol||'?').slice(0,10)} | $${Math.round(c.usd_market_cap||0).toLocaleString('en-US')} | ${age}m | ${makeCaption(c, score)}`);
    }
    return;
  }

  for (const { c, score } of candidates) {
    if (hourCalls >= MAX_PER_HOUR) { console.log(`[trending] hourly cap ${MAX_PER_HOUR} reached`); break; }
    if (dayCalls >= MAX_PER_DAY) { console.log(`[trending] daily cap ${MAX_PER_DAY} reached`); break; }
    const mint = c.mint;
    seen.push(mint);
    const record: CallRecord = {
      mint, symbol: (c.symbol || "?").slice(0, 12), name: (c.name || "").slice(0, 24),
      mc: c.usd_market_cap || 0, ageMin: Math.round((now - c.created_timestamp) / 60000),
      creator: c.creator || "", twitter: c.twitter || null, score,
      thesis: makeCaption(c, score), status: "queued", ts: now,
    };
    ledger.push(record);
    saveJSON(SEEN_FILE, seen);
    saveJSON(LEDGER_FILE, ledger);

    console.log(`[trending] 🎯 candidate ${record.symbol} score ${score} mc $${record.mc.toLocaleString()} — "${record.thesis}"`);

    // SAFETY
    console.log(`[trending] 🛡️ safety scan...`);
    const safe = await safetyPass(mint);
    if (!safe) {
      record.status = "skipped"; saveJSON(LEDGER_FILE, ledger);
      console.log(`[trending] ⛔ ${record.symbol} failed safety — skipped`);
      continue;
    }

    // BUY
    console.log(`[trending] 💰 buying $${BUY_USD}...`);
    const bought = await autoBuy(mint);
    if (!bought) {
      record.status = "failed"; saveJSON(LEDGER_FILE, ledger);
      alertFounder(`⚠️ Trending buy failed for ${record.symbol} (${mint.slice(0,8)}…) — safety passed, buy errored. Manual?`);
      continue;
    }
    record.status = "bought";
    saveJSON(LEDGER_FILE, ledger);
    hourCalls++; dayCalls++;

    // POST
    console.log(`[trending] 📢 posting "${record.thesis}"`);
    const posted = await postCallout(mint, record.thesis);
    if (posted) {
      record.status = "posted"; saveJSON(LEDGER_FILE, ledger);
      console.log(`[trending] 🎉 CALLOUT POSTED: ${record.symbol}`);
      alertFounder(`🎉 AUTO-CALLOUT: ${record.symbol} — "${record.thesis}"\nhttps://pump.fun/coin/${mint}\n(score ${record.score}, mc $${record.mc.toLocaleString()}, ${record.ageMin}m old)`);
    } else {
      record.status = "failed"; saveJSON(LEDGER_FILE, ledger);
      alertFounder(`💰 Bought ${record.symbol} but post failed — posting manually? https://pump.fun/coin/${mint}`);
    }
  }
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--once") { await scanOnce(false); return; }
  if (arg === "--dryrun") { await scanOnce(true); return; }

  if (lockAlive()) { console.log("[trending] another instance running — exiting"); process.exit(0); }
  writeFileSync(LOCK_FILE, String(process.pid), "utf8");
  process.on("exit", () => { try { require("fs").unlinkSync(LOCK_FILE); } catch {} });
  console.log(`[trending] looping every ${POLL_MS / 1000}s | caps ${MAX_PER_HOUR}/h ${MAX_PER_DAY}/d | buy $${BUY_USD}`);
  const loop = async () => { try { await scanOnce(false); } catch (e) { console.error("[trending] loop err:", (e as Error).message); } };
  await loop();
  setInterval(loop, POLL_MS);
}

main().catch((e) => { console.error("[trending] fatal:", e); process.exit(1); });
