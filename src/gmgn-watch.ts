/**
 * gmgn-watch.ts — THE CALLOUT ENGINE v3 (GMGN signal + pumpdev execution)
 *
 * Signal: GMGN trending (rich: buy/sell pressure, momentum, safety flags)
 * Safety: built-in (is_honeypot, rug_ratio, bundler_rate, dev holds)
 * Buy:    pumpdev REST (api-rail) — no browser
 * Post:   pump.fun keypair callout (api-rail) — no browser
 *
 * Playbook (founder-validated):
 *   micro tier:   $3K-150K mc, young, moving — "EARLY/RIPPING" voice
 *   liquid tier:  $5M-100M mc, volume + dip/momentum — dip-buy confidence voice
 *
 * Risk (surgical): 2/h, 6/day, ~$1.45 buy (clears the $1.1 gate w/ slippage),
 * pre-flight balance check.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as api from "./api-rail";

const DATA_DIR = path.join(process.cwd(), ".megaphone");
const LEDGER_FILE = path.join(DATA_DIR, "gmgn-calls.json");
const SEEN_FILE = path.join(DATA_DIR, "gmgn-seen.json");
const LOCK_FILE = path.join(DATA_DIR, "gmgn-watch.lock");
const FOUNDER_DM = "telegram:1915394365";

const POLL_MS = 90_000;
const BUY_SOL = Number(process.env.GMGN_BUY_SOL || 0.014); // ~$1.45 @ ~$103/SOL
const MAX_PER_HOUR = Number(process.env.GMGN_MAX_HOUR || 2);
const MAX_PER_DAY = Number(process.env.GMGN_MAX_DAY || 6);
const MIN_SOL_TO_RUN = 0.05; // pre-flight floor (~$5)

interface CallRecord {
  mint: string; symbol: string; mc: number; ageMin: number; score: number;
  thesis: string; tier: "micro" | "liquid"; status: string; ts: number; detail?: string;
}

function loadJSON<T>(f: string, d: T): T { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } }
function saveJSON(f: string, v: any) {
  writeFileSync(f + ".tmp", JSON.stringify(v, null, 2));
  try { execSync(`move /y "${f}.tmp" "${f}"`, { shell: "cmd.exe", stdio: "ignore" }); } catch { writeFileSync(f, JSON.stringify(v, null, 2)); }
}

function alertFounder(msg: string) {
  try {
    const tmp = path.join(DATA_DIR, "gmgn-alert.tmp.txt");
    writeFileSync(tmp, msg, "utf8");
    execSync(`hermes send --to ${FOUNDER_DM} -f "${tmp}"`, { timeout: 15000, windowsHide: true, stdio: "ignore" });
  } catch (e) { console.error("alert fail:", (e as Error).message.slice(0, 100)); }
}

function gmgnTrending(interval: string, minMc: number, maxMc: number): any[] {
  const cmd = `gmgn-cli market trending --chain sol --interval ${interval} --limit 100 --platform "Pump.fun" --min-marketcap ${minMc} --max-marketcap ${maxMc} --order-by volume --direction desc --raw`;
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 40000, windowsHide: true });
    const j = JSON.parse(out);
    return j?.data?.rank || [];
  } catch (e) {
    console.log(`[gmgn] trending fetch err: ${(e as Error).message.slice(0, 80)}`);
    return [];
  }
}

/** Safety: PASS only. Rug/honeypot/bundler/dev-hold flags kill the call. */
function safetyOk(t: any): { ok: boolean; why?: string } {
  if (t.is_honeypot) return { ok: false, why: "honeypot" };
  if (!t.is_renounced && t.renounced_mint !== 1) return { ok: false, why: "mint not renounced" };
  if ((t.bundler_rate || 0) > 0.3) return { ok: false, why: `bundler ${(t.bundler_rate * 100).toFixed(0)}%` };
  if ((t.bot_degen_rate || 0) > 0.3) return { ok: false, why: `bots ${(t.bot_degen_rate * 100).toFixed(0)}%` };
  if ((t.dev_team_hold_rate || 0) > 0.2) return { ok: false, why: `dev holds ${(t.dev_team_hold_rate * 100).toFixed(0)}%` };
  if (t.creator_close) return { ok: false, why: "creator closed" };
  if (t.is_wash_trading) return { ok: false, why: "wash trading" };
  return { ok: true };
}

/** Score micro tier ($3K-150K): young + buy pressure + momentum = "early" call. */
function scoreMicro(t: any, nowMs: number): number {
  const createdMs = (t.creation_timestamp || nowMs / 1000) * 1000; // GMGN uses epoch SECONDS
  const ageMs = nowMs - createdMs;
  if (ageMs < 2 * 60_000 || ageMs > 6 * 3600_000) return 0;
  const mc = t.market_cap || 0;
  if (mc < 3000 || mc > 150_000) return 0;
  let s = 50;
  if (ageMs < 60 * 60_000) s += 20; else if (ageMs < 3 * 3600_000) s += 10; else s += 5;
  const buys = t.buys || 0, sells = t.sells || 0, swaps = t.swaps || 0;
  const ratio = sells > 0 ? buys / sells : buys > 0 ? 3 : 0;
  if (ratio >= 2) s += 15; else if (ratio >= 1.2) s += 8; else if (ratio < 0.8 && sells > 20) s -= 10;
  // GMGN 1m window is noisy (-40% prints on winners); trust 5m/1h momentum
  const ch5m = t.price_change_percent5m || 0;
  const ch1h = t.price_change_percent1h || 0;
  if (ch5m > 8 || ch1h > 30) s += 8;
  else if (ch5m > 3 || ch1h > 10) s += 5;
  else if (ch1h < -30) s -= 8;
  if (swaps >= 50) s += 5; else if (swaps < 10) s -= 5;
  if ((t.holder_count || 0) >= 100) s += 3;
  if ((t.hot_level || 0) >= 1) s += 4;
  if (s < 60) return 0;
  return Math.min(100, Math.round(s));
}

/** Score liquid tier ($5M-100M): volume + dip or momentum = commission call. */
function scoreLiquid(t: any): number {
  const mc = t.market_cap || 0;
  if (mc < 5_000_000 || mc > 100_000_000) return 0;
  const vol = t.volume || 0;
  if (vol < 100_000) return 0;
  let s = 55;
  const ch1h = t.price_change_percent1h || 0;
  // dip-buy setup: -40%..-5% on real volume with buys coming back
  if (ch1h <= -5 && ch1h >= -40) { s += 20; }
  else if (ch1h > 5 && ch1h < 40) { s += 15; } // momentum
  else if (ch1h >= 40) { s += 8; } // already ran — late but visible
  else return 0;
  const buys = t.buys || 0, sells = t.sells || 0;
  const ratio = sells > 0 ? buys / sells : 1;
  if (ratio >= 1.5) s += 10; else if (ratio < 0.6) s -= 8;
  if (vol >= 1_000_000) s += 8; else if (vol >= 300_000) s += 4;
  if (t.is_renounced) s += 4;
  if ((t.holder_count || 0) >= 5000) s += 3;
  return s >= 65 ? Math.min(100, Math.round(s)) : 0;
}

function cleanHandle(u: string): string {
  if (!u) return "";
  let h = u.replace(/^https?:\/\/(x|twitter)\.com\//, "").replace(/^@/, "").split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) h = "";
  return h;
}

function ageMinOf(t: any): number {
  const createdMs = (t.creation_timestamp || Date.now() / 1000) * 1000;
  return Math.round((Date.now() - createdMs) / 60000);
}

/** Caption in the founder's voice — two tiers, two tones. */
function makeCaption(t: any, score: number, tier: string): string {
  const sym = (t.symbol || t.name || "?").toUpperCase().replace(/\s+/g, " ").trim().slice(0, 14);
  const handle = cleanHandle(t.twitter_username);
  const ageMin = ageMinOf(t);
  if (tier === "liquid") {
    const ch1h = t.price_change_percent1h || 0;
    const opts: string[] = [];
    if (handle) opts.push(`${sym} by @${handle}`);
    if (ch1h <= -5) opts.push(`${sym} dip looks juicy`);
    opts.push(`${sym} solid volume`);
    opts.push(`${sym} getting attention`);
    const dipHype = ["Amazing dip. Dont fade this", "Big dip = big entry", "Dont let this dip scare you", "This is the entry"];
    const momHype = ["RUNNING", "Momentum building", "Volume is REAL"];
    const base = opts.filter(Boolean)[Math.floor(Math.random() * Math.max(1, opts.filter(Boolean).length))];
    const punch = ch1h <= -5 ? dipHype[Math.floor(Math.random() * dipHype.length)] : momHype[Math.floor(Math.random() * momHype.length)];
    return score >= 80 ? `${punch} — ${sym}` : `${base} — ${punch}`;
  }
  // micro tier
  const opts: string[] = [];
  if (handle) opts.push(`${sym} by @${handle}`);
  opts.push(`${sym} EARLY`);
  if (ageMin <= 30) opts.push(`${sym} ${ageMin}m old`);
  opts.push(`${sym} MOVING`);
  const hype = ["LET'S GO", "RIPPING", "RUNNER", "HOLY RUNNER", "MASSIVE", "GET IN"];
  const base = opts[Math.floor(Math.random() * opts.length)];
  if (score >= 75) return `${base} ${hype[Math.floor(Math.random() * hype.length)]}`;
  if (score >= 60) return `${base} — early`;
  return base;
}

async function scanOnce(dryRun: boolean) {
  const now = Date.now();
  const ledger = loadJSON<CallRecord[]>(LEDGER_FILE, []);
  const seen = loadJSON<string[]>(SEEN_FILE, []);
  let hourUsed = ledger.filter((c) => now - c.ts < 3600_000 && ["posted", "bought"].includes(c.status)).length;
  let dayUsed = ledger.filter((c) => now - c.ts < 86400_000 && ["posted", "bought"].includes(c.status)).length;

  // fetch both tiers
  const micro = gmgnTrending("1m", 3000, 150_000);
  const liquid = gmgnTrending("1h", 5_000_000, 100_000_000);
  console.log(`[gmgn] fetched micro ${micro.length}, liquid ${liquid.length} (hour ${hourUsed}/${MAX_PER_HOUR}, day ${dayUsed}/${MAX_PER_DAY})`);

  const cands: { t: any; score: number; tier: "micro" | "liquid" }[] = [];
  for (const t of micro) {
    if (seen.includes(t.address)) continue;
    const s = scoreMicro(t, now);
    if (s >= 60) { const safe = safetyOk(t); if (safe.ok) cands.push({ t, score: s, tier: "micro" }); else console.log(`[gmgn] ⛔ micro ${(t.symbol||'').slice(0,10)} safety: ${safe.why}`); }
  }
  for (const t of liquid) {
    if (seen.includes(t.address)) continue;
    const s = scoreLiquid(t);
    if (s >= 65) { const safe = safetyOk(t); if (safe.ok) cands.push({ t, score: s, tier: "liquid" }); else console.log(`[gmgn] ⛔ liquid ${(t.symbol||'').slice(0,10)} safety: ${safe.why}`); }
  }
  cands.sort((a, b) => b.score - a.score);

  if (dryRun) {
    console.log(`[gmgn] DRY-RUN — ${cands.length} candidates`);
    for (const { t, score, tier } of cands.slice(0, 10)) {
      const age = ageMinOf(t);
      console.log(`  ${score} | ${tier} | ${(t.symbol || "?").slice(0, 12)} | $${Math.round(t.market_cap || 0).toLocaleString("en-US")} | ${age}m | b:${t.buys} s:${t.sells} | ${makeCaption(t, score, tier)}`);
    }
    return;
  }

  if (hourUsed >= MAX_PER_HOUR) { console.log(`[gmgn] hourly cap ${MAX_PER_HOUR}`); return; }

  // pre-flight SOL balance
  const bal = await api.apiSolBalance();
  if (bal < MIN_SOL_TO_RUN) {
    alertFounder(`⛽ GMGN engine: pumpdev wallet at ${bal.toFixed(3)} SOL — below ${MIN_SOL_TO_RUN} floor. Top up 6xxWhUvg9szw5BmnmeNbEBd3Rv9hDBcAX6AHLbapLDBa to keep the loop firing.`);
    return;
  }

  for (const { t, score, tier } of cands) {
    if (hourUsed >= MAX_PER_HOUR) break;
    if (dayUsed >= MAX_PER_DAY) break;
    const mint = t.address;
    seen.push(mint);
    saveJSON(SEEN_FILE, seen);
    const thesis = makeCaption(t, score, tier);
    const rec: CallRecord = {
      mint, symbol: (t.symbol || "?").slice(0, 12), mc: t.market_cap || 0,
      ageMin: ageMinOf(t), score, thesis,
      tier, status: "queued", ts: now,
    };
    ledger.push(rec); saveJSON(LEDGER_FILE, ledger);
    console.log(`[gmgn] 🎯 ${tier} ${rec.symbol} score ${score} mc $${rec.mc.toLocaleString()} — "${thesis}"`);

    console.log(`[gmgn] 💰 API buy ${BUY_SOL} SOL...`);
    const sig = await api.apiBuy(mint, BUY_SOL);
    if (!sig) {
      rec.status = "failed"; rec.detail = "buy failed"; saveJSON(LEDGER_FILE, ledger);
      alertFounder(`⚠️ ${tier.toUpperCase()} buy FAILED for ${rec.symbol} (${mint.slice(0, 8)}…) — ${thesis}`);
      continue;
    }
    rec.status = "bought"; saveJSON(LEDGER_FILE, ledger);
    hourUsed++; dayUsed++;

    console.log(`[gmgn] 📢 posting "${thesis}"`);
    const post = await api.apiPostCallout(mint, thesis, { waitMs: 15000 });
    if (post.ok) {
      rec.status = "posted"; rec.detail = post.detail; saveJSON(LEDGER_FILE, ledger);
      console.log(`[gmgn] 🎉 CALLOUT POSTED (${post.detail}): ${rec.symbol}`);
      alertFounder(`🎉 AUTO-CALLOUT [${tier.toUpperCase()}]: ${rec.symbol} — "${thesis}"\nhttps://pump.fun/coin/${mint}\n(score ${score}, mc $${rec.mc.toLocaleString()}, ${rec.ageMin}m old)`);
    } else {
      rec.status = "failed"; rec.detail = post.detail; saveJSON(LEDGER_FILE, ledger);
      alertFounder(`💰 Bought ${rec.symbol} (${tier}) but post failed: ${post.detail}\nManual? https://pump.fun/coin/${mint}`);
    }
  }
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--dryrun") { await scanOnce(true); return; }
  if (arg === "--once") { await scanOnce(false); return; }
  if (arg === "--reset-seen") { saveJSON(SEEN_FILE, []); console.log("[gmgn] seen reset"); return; }
  try {
    const pid = parseInt(readFileSync(LOCK_FILE, "utf8").trim());
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8" }).trim();
    if (out.includes(String(pid))) { console.log("[gmgn] another instance running — exiting"); process.exit(0); }
  } catch {}
  writeFileSync(LOCK_FILE, String(process.pid), "utf8");
  process.on("exit", () => { try { require("fs").unlinkSync(LOCK_FILE); } catch {} });
  console.log(`[gmgn] looping every ${POLL_MS / 1000}s | caps ${MAX_PER_HOUR}/h ${MAX_PER_DAY}/d | buy ${BUY_SOL} SOL | floor ${MIN_SOL_TO_RUN} SOL`);
  const loop = async () => { try { await scanOnce(false); } catch (e) { console.error("[gmgn] loop err:", (e as Error).message); } };
  await loop();
  setInterval(loop, POLL_MS);
}

main().catch((e) => { console.error("[gmgn] fatal:", e); process.exit(1); });
