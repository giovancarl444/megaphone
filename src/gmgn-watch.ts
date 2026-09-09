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


const DATA_DIR = path.join(process.cwd(), ".megaphone");
const LEDGER_FILE = path.join(DATA_DIR, "gmgn-calls.json");
const SEEN_FILE = path.join(DATA_DIR, "gmgn-seen.json");
const LOCK_FILE = path.join(DATA_DIR, "gmgn-watch.lock");
const FOUNDER_DM = "telegram:1915394365";

const POLL_MS = 90_000;
const MAX_PER_HOUR = Number(process.env.GMGN_MAX_HOUR || 2);
const MAX_PER_DAY = Number(process.env.GMGN_MAX_DAY || 6);

interface CallRecord {
  mint: string; symbol: string; mc: number; ageMin: number; score: number;
  thesis: string; tier: "micro" | "liquid"; status: string; ts: number; detail?: string;
  mcUsd?: number; // pump.fun usd_market_cap at buy time — the SAME-SOURCE exit baseline
  exitAt?: number; exitPnl?: number; exitReason?: string;
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

/** BROWSER RAIL: buy $1.2 as drew_patel through the live CDP session. */
async function browserBuy(mint: string): Promise<boolean> {
  try {
    const out = execSync(`node src/auto-buy.mjs ${mint} 1.2`, {
      encoding: "utf8", timeout: 150000, windowsHide: true, cwd: process.cwd(),
    });
    return /DONE|BALANCE MOVED|success/i.test(out);
  } catch (e) {
    console.log(`[gmgn] buy err: ${(e as Error).message.slice(0, 120)}`);
    return false;
  }
}

/** BROWSER RAIL: post callout as drew_patel through the live session. */
async function browserPost(mint: string, thesis: string): Promise<boolean> {
  try {
    const out = execSync(
      `node node_modules/tsx/dist/cli.mjs src/callout-poster.ts ${mint} "${thesis.replace(/"/g, "'")}"`,
      { encoding: "utf8", timeout: 90000, windowsHide: true, cwd: process.cwd() },
    );
    return /201|calloutId|posted|success|DUPLICATE/i.test(out);
  } catch (e) {
    console.log(`[gmgn] post err: ${(e as Error).message.slice(0, 120)}`);
    return false;
  }
}

/** BROWSER RAIL: sell full position as drew_patel (profit/stop rail). */
async function browserSell(mint: string): Promise<boolean> {
  try {
    const out = execSync(`node src/auto-sell.mjs ${mint}`, {
      encoding: "utf8", timeout: 150000, windowsHide: true, cwd: process.cwd(),
    });
    return /SELL_DONE|success|sold/i.test(out);
  } catch (e) {
    console.log(`[gmgn] sell err: ${(e as Error).message.slice(0, 120)}`);
    return false;
  }
}

/** On-chain token balance for the founder wallet (RPC ground truth). */
function tokenBalance(mint: string): number | null {
  try {
    const out = execSync(
      `node src/token-balance.mjs ${mint}`,
      { encoding: "utf8", timeout: 25000, windowsHide: true, cwd: process.cwd() },
    );
    const n = parseFloat(out.trim());
    return isFinite(n) ? n : null;
  } catch { return null; }
}

/** Live USD market cap via pump.fun public API (source of truth for exits). */
function liveMcUsd(mint: string): number | null {
  try {
    const out = execSync(
      `curl -s --max-time 15 "https://frontend-api-v3.pump.fun/coins/${mint}" -H "Accept: application/json"`,
      { encoding: "utf8", timeout: 20000, windowsHide: true },
    );
    const j = JSON.parse(out);
    const usd = j?.usd_market_cap;
    const sol = j?.market_cap;
    // usd_market_cap is the real USD value; fall back to SOL field * ~101 if absent
    return usd != null ? Number(usd) : sol != null ? Number(sol) * 101 : null;
  } catch { return null; }
}

/** SCALP-EXIT BRAIN: protect fresh callouts, bank aged winners, cut aged losers.
 *  Rules (founder-approved "callouts + scalping" hybrid):
 *   - age < 6h:  never touch (callout is gathering views)
 *   - age >= 6h && pnl >= +50%: SELL (take profit, recycle fuel)
 *   - age >= 24h && pnl <= -40%: SELL (cut, recycle)
 *  PnL is computed SAME-SOURCE: pump.fun usd_market_cap at buy (rec.mcUsd)
 *  vs live usd_market_cap. GMGN's market_cap field is NOT comparable to
 *  pump.fun's usd_market_cap (founder screenshot proved a 2x discrepancy),
 *  so entries without mcUsd are never auto-sold. */
async function exitCheck(ledger: CallRecord[]): Promise<void> {
  const now = Date.now();
  for (const rec of ledger) {
    if (!["posted", "bought"].includes(rec.status)) continue;
    if (rec.exitAt) continue; // already exited
    const ageH = (now - rec.ts) / 3600_000;
    if (ageH < 6) continue; // protected window — callout lives
    if (!rec.mcUsd || rec.mcUsd <= 0) continue; // no same-source entry -> never auto-sell
    const cur = liveMcUsd(rec.mint);
    if (cur == null || cur <= 0) continue;
    const pnl = cur / rec.mcUsd - 1;
    const takeProfit = pnl >= 0.5;
    const stopLoss = ageH >= 24 && pnl <= -0.4;
    if (!takeProfit && !stopLoss) continue;
    console.log(`[gmgn] 🎯 EXIT ${rec.symbol}: pnl ${(pnl * 100).toFixed(0)}% (${cur.toLocaleString()} vs entry ${rec.mcUsd.toLocaleString()}, ${ageH.toFixed(1)}h) — selling`);
    const sold = await browserSell(rec.mint);
    if (sold) {
      rec.status = "sold"; rec.exitAt = now; rec.exitPnl = pnl; rec.exitReason = takeProfit ? "take-profit" : "stop-loss";
      saveJSON(LEDGER_FILE, ledger);
      alertFounder(`💰 EXIT ${rec.symbol}: ${(pnl * 100).toFixed(0)}% (${takeProfit ? "take-profit" : "stop-loss"}) — fuel recycled\nhttps://pump.fun/coin/${rec.mint}`);
    } else {
      alertFounder(`⚠️ EXIT FAILED for ${rec.symbol} (${(pnl * 100).toFixed(0)}%) — sell script error`);
    }
  }
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

/** Safety: composite risk model. Untouchable = honeypot/wash/unrenounced.
 *  Everything else stacks: strong buy pressure offsets bot/bundler noise
 *  (snipers chase real runners on pump.fun); stacked red flags kill. */
function safetyOk(t: any): { ok: boolean; why?: string; penalty?: number } {
  // absolute killers — no exception
  if (t.is_honeypot) return { ok: false, why: "honeypot" };
  if (t.is_wash_trading) return { ok: false, why: "wash trading" };
  if (!t.is_renounced && t.renounced_mint !== 1) return { ok: false, why: "mint not renounced" };

  const bundler = t.bundler_rate || 0;
  const bots = t.bot_degen_rate || 0;
  const devHold = t.dev_team_hold_rate || 0;
  const creatorOut = !!t.creator_close;
  const buys = t.buys || 0, sells = t.sells || 0;
  const ratio = sells > 0 ? buys / sells : buys > 0 ? 3 : 0;
  const strongDemand = ratio >= 1.5 && buys >= 60;

  let strikes = 0;
  if (bundler > 0.45) strikes += 2; else if (bundler > 0.3) strikes += 1;
  if (bots > 0.6) strikes += 2; else if (bots > 0.45) strikes += 1;
  if (devHold > 0.25) strikes += 2; else if (devHold > 0.15) strikes += 1;
  if (creatorOut && !strongDemand) strikes += 1;

  // stacked red flags = junk; single flag with real demand = rideable
  if (strikes >= 3 && !strongDemand) return { ok: false, why: `risk ${bundler > 0.3 ? "bundler " + (bundler * 100).toFixed(0) + "% " : ""}${bots > 0.45 ? "bots " + (bots * 100).toFixed(0) + "%" : ""}` };
  if (strikes >= 4) return { ok: false, why: "stacked risk flags" };

  // soft penalty scales with remaining risk
  let penalty = strikes * 4;
  if (creatorOut && !strongDemand) penalty += 3; // dev exited, community must carry
  return { ok: true, penalty };
}

/** True only for coins still on the pump.fun bonding curve (buyable via $1 UI buy). */
function onBondingCurve(t: any): boolean {
  return (t.launchpad_status === 0 || t.exchange === "pump") && (t.launchpad_platform || "") === "Pump.fun";
}

/** Score micro tier ($3K-60K, bonding curve only): young + buy pressure + momentum. */
function scoreMicro(t: any, nowMs: number): number {
  if (!onBondingCurve(t)) return 0;
  const createdMs = (t.creation_timestamp || nowMs / 1000) * 1000; // GMGN uses epoch SECONDS
  const ageMs = nowMs - createdMs;
  if (ageMs < 2 * 60_000 || ageMs > 6 * 3600_000) return 0;
  const mc = t.market_cap || 0;
  if (mc < 3000 || mc > 60_000) return 0; // 60K < ~69K graduation
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
  let hourUsed = ledger.filter((c) => now - c.ts < 3600_000 && ["posted", "bought", "attempted"].includes(c.status)).length;
  let dayUsed = ledger.filter((c) => now - c.ts < 86400_000 && ["posted", "bought", "attempted"].includes(c.status)).length;

  // SCALP-EXIT BRAIN first: bank aged winners / cut aged losers, freeing fuel
  // before we hunt new calls (only when not in dry-run).
  if (!dryRun) await exitCheck(ledger);

  // fetch both tiers (liquid gated behind env flag until graduated-buy proven)
  const LIQUID_ENABLED = process.env.GMGN_LIQUID === "1";
  const micro = gmgnTrending("1m", 3000, 60_000);
  const liquid = LIQUID_ENABLED ? gmgnTrending("1h", 5_000_000, 100_000_000) : [];
  console.log(`[gmgn] fetched micro ${micro.length}, liquid ${liquid.length} (hour ${hourUsed}/${MAX_PER_HOUR}, day ${dayUsed}/${MAX_PER_DAY})`);

  const cands: { t: any; score: number; tier: "micro" | "liquid" }[] = [];
  for (const t of micro) {
    if (seen.includes(t.address)) continue;
    const s = scoreMicro(t, now);
    if (s >= 60) {
      const safe = safetyOk(t);
      if (safe.ok) cands.push({ t, score: Math.max(0, s - (safe.penalty || 0)), tier: "micro" });
      else console.log(`[gmgn] ⛔ micro ${(t.symbol||'').slice(0,10)} safety: ${safe.why}`);
    }
  }
  if (LIQUID_ENABLED) {
    for (const t of liquid) {
      if (seen.includes(t.address)) continue;
      const s = scoreLiquid(t);
      if (s >= 65) {
        const safe = safetyOk(t);
        if (safe.ok) cands.push({ t, score: Math.max(0, s - (safe.penalty || 0)), tier: "liquid" });
        else console.log(`[gmgn] ⛔ liquid ${(t.symbol||'').slice(0,10)} safety: ${safe.why}`);
      }
    }
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

  // NOTE: buys happen as drew_patel in the browser session — auto-buy.mjs has
  // its own pre-flight balance check against the live session balance.

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

    console.log(`[gmgn] 💰 buy $1.2 as drew_patel (browser rail)...`);
    const bought = await browserBuy(mint);
    // TRUTH: only a real on-chain position counts as bought (auto-buy.mjs
    // historically false-DONEs). Verify token balance via RPC before posting.
    const heldAmt = await tokenBalance(mint);
    if (!bought || heldAmt == null || heldAmt <= 0) {
      rec.status = "attempted"; rec.detail = bought ? "buy false-positive (no on-chain position)" : "buy failed";
      saveJSON(LEDGER_FILE, ledger);
      hourUsed++; dayUsed++; // failed attempts STILL consume cap slots
      alertFounder(`⚠️ ${tier.toUpperCase()} buy FAILED/UNVERIFIED for ${rec.symbol} (${mint.slice(0, 8)}…) — ${thesis}`);
      continue;
    }
    rec.status = "bought"; rec.detail = `held ${heldAmt.toFixed(0)}`; saveJSON(LEDGER_FILE, ledger);
    hourUsed++; dayUsed++;
    // record pump.fun usd_market_cap at buy time — the same-source exit baseline
    const buyMc = liveMcUsd(mint);
    if (buyMc != null && buyMc > 0) { rec.mcUsd = buyMc; saveJSON(LEDGER_FILE, ledger); }

    console.log(`[gmgn] 📢 posting "${thesis}"`);
    const post = await browserPost(mint, thesis);
    if (post) {
      rec.status = "posted"; rec.detail = "ok"; saveJSON(LEDGER_FILE, ledger);
      console.log(`[gmgn] 🎉 CALLOUT POSTED: ${rec.symbol}`);
      alertFounder(`🎉 AUTO-CALLOUT [${tier.toUpperCase()}]: ${rec.symbol} — "${thesis}"\nhttps://pump.fun/coin/${mint}\n(score ${score}, mc $${rec.mc.toLocaleString()}, ${rec.ageMin}m old)`);
    } else {
      // KEEP "bought" status — a bought position still counts toward caps.
      // Flipping to "failed" here was THE runaway bug: caps recompute from
      // ledger each scan, failed posts vanished from the count, engine looped.
      rec.status = "bought"; rec.detail = "post failed (position held)"; saveJSON(LEDGER_FILE, ledger);
      alertFounder(`💰 Bought ${rec.symbol} (${tier}) but post failed — manual? https://pump.fun/coin/${mint}`);
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
  console.log(`[gmgn] looping every ${POLL_MS / 1000}s | caps ${MAX_PER_HOUR}/h ${MAX_PER_DAY}/d | buy $1.2 as drew_patel`);
  const loop = async () => { try { await scanOnce(false); } catch (e) { console.error("[gmgn] loop err:", (e as Error).message); } };
  await loop();
  setInterval(loop, POLL_MS);
}

main().catch((e) => { console.error("[gmgn] fatal:", e); process.exit(1); });
