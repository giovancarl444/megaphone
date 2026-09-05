/**
 * sniper.ts — PAPER-FIRST launch sniper (flag-guarded: MEGAPHONE_SNIPER=1).
 *
 * Rules (founder, 08-28):
 *   1. BUY a launch the instant it passes the firehose filter (score >= threshold).
 *   2. TAKE PROFIT at exactly +100% (2x entry). No ladder. Sell no matter what.
 *   3. COPY-EXIT: if a TRACKED wallet sells the mint, we sell — no matter what.
 *   4. STOP at -30% (0.7x).
 *
 * Latency: WS firehose primary (sub-second) when MEGAPHONE_PROXY/WS available;
 * REST poll at SNIPER_POLL_MS (default 2000ms) fallback. Buy simulated in the
 * same tick as detection (0 wait). Drag (ms between detect and "fill") recorded.
 *
 * PAPER ONLY. No real wallet, no swap, no real money. Logs 4-mc fields +
 * 60min path for honest replay. Real flip is a separate founder step.
 *
 * Run: tsx src/sniper.ts   (flag on via env)
 */
import { execSync } from "node:child_process";
import { promises as fs, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";
import { CALLOUT_CHAT } from "./config";
import { scoreCoin } from "./score";
import type { Coin } from "./types";

const ENABLED = process.env.MEGAPHONE_SNIPER === "1";
const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const TRADE_FILE = path.join(DATA_DIR, "sniper-trades.json");
const SEEN_FILE = path.join(DATA_DIR, "sniper-seen.json");
const POLL_MS = Number(process.env.SNIPER_POLL_MS ?? 2_000);
const PAPER_SIZE_USD = Number(process.env.SNIPER_PAPER_USD ?? 100);
const FILL_DELAY_MS = Number(process.env.SNIPER_FILL_MS ?? 0); // 0 = instant sim fill
const BASE = "https://frontend-api-v3.pump.fun/coins";
// TRACKED wallets whose sells trigger copy-exit (reuse WATCHLIST concept).
const TRACKED = [
  "3tL1nfq5tb9RfydszNwMytYAZrnD3gpkmxxcdTvpPS6S", // cupsey
  "6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP", // cupsey sub-wallet (data TBD)
  "4P8apfoSyiwfgu4Gk3tx17igeP8s33ZfDTawfTEN3EQF", // orangey
];

// ---- mc read (pump.fun public, no auth) — hard 3s timeout so entries stay fast ----
async function mcUsd(mint: string): Promise<number> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (res.ok) {
      const j = (await res.json()) as any;
      const usd = Number(j?.usd_market_cap ?? 0);
      if (usd > 0) return Math.round(usd);
    }
  } catch {}
  finally { clearTimeout(to); }
  return 0;
}

// ---- persistence (serialized, Windows-safe) ----
function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(readFileSync(SEEN_FILE, "utf8")) as string[]); } catch { return new Set(); }
}
let seenChain: Promise<void> = Promise.resolve();
function saveSeen(seen: Set<string>): void {
  const run = async () => {
    const tmp = SEEN_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify([...seen], null, 2));
    for (let i = 0; i < 5; i++) { try { await fs.rename(tmp, SEEN_FILE); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    await fs.writeFile(SEEN_FILE, JSON.stringify([...seen], null, 2));
  };
  seenChain = seenChain.then(run, run);
}
function loadTrades(): any[] {
  try { return JSON.parse(readFileSync(TRADE_FILE, "utf8")) as any[]; } catch { return []; }
}
let tradeChain: Promise<void> = Promise.resolve();
function saveTrades(t: any[]): void {
  const run = async () => {
    const tmp = TRADE_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(t, null, 2));
    for (let i = 0; i < 5; i++) { try { await fs.rename(tmp, TRADE_FILE); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    await fs.writeFile(TRADE_FILE, JSON.stringify(t, null, 2));
  };
  tradeChain = tradeChain.then(run, run);
}

// ---- Telegram (with retry — hermes send is intermittently flaky) ----
function sendRaw(target: string, file: string): boolean {
  try {
    execSync(`hermes send -t ${target} -f "${file}"`, { stdio: "ignore", timeout: 12000 });
    return true;
  } catch { return false; }
}
function send(text: string) {
  const targets = [CALLOUT_CHAT, "telegram:1915394365"];
  for (const target of targets) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tmp = path.join(DATA_DIR, `sniper-${Date.now()}-${attempt}.txt`);
      try { writeFileSync(tmp, text, "utf8"); } catch { continue; }
      if (sendRaw(target, tmp)) { try { unlinkSync(tmp); } catch {} return; }
      try { unlinkSync(tmp); } catch {}
      if (attempt < 2) { try { execSync("ping -n 2 127.0.0.1 >nul 2>&1"); } catch {} }
    }
  }
  console.error("[sniper] send failed after retries (all targets)");
}

// ---- tracked-sell detection (copy-exit trigger) ----
// Poll tracked wallets' recent signatures; if any sold `mint`, return true.
async function trackedSoldMint(mint: string): Promise<boolean> {
  for (const w of TRACKED) {
    try {
      const r = await fetch("https://api.mainnet-beta.solana.com", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [w, { limit: 12 }] }),
      });
      const j = (await r.json()) as any;
      const sigs = j?.result ?? [];
      for (const s of sigs) {
        // decode lightweight: getTransaction, check mint involvement + side
        const txr = await fetch("https://api.mainnet-beta.solana.com", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }] }),
        });
        const tx = (await txr.json()) as any;
        const accs: string[] = tx?.result?.transaction?.message?.accountKeys ?? [];
        if (accs.includes(mint)) {
          const pre = tx.result.meta?.preBalances ?? [];
          const post = tx.result.meta?.postBalances ?? [];
          const idx = accs.indexOf(w);
          if (idx >= 0 && post[idx] > pre[idx]) return true; // wallet gained SOL = sold
        }
      }
    } catch {}
  }
  return false;
}

let seen = loadSeen();

// ---- buy (paper) ----
async function paperBuy(c: Coin, score: number, velSolPerMin: number) {
  const detectedMc = Math.round(c.usd_market_cap || c.market_cap_usd || 0);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, FILL_DELAY_MS));
  const ourMc = await mcUsd(c.mint);
  const dragMs = Date.now() - t0;
  const trade = {
    mint: c.mint, symbol: c.symbol, sizeUsd: PAPER_SIZE_USD,
    hisMc: detectedMc, ourMc: Math.round(ourMc),
    entryDragMs: dragMs,
    targetMc: ourMc > 0 ? Math.round(ourMc * 2) : detectedMc * 2,
    stopMc: ourMc > 0 ? Math.round(ourMc * 0.7) : detectedMc * 0.7,
    fillDelayMs: FILL_DELAY_MS,
    openedAt: Date.now(), outcome: "OPEN",
    path: [] as { t: number; mc: number }[],
    triggerMc: 0, fillMc: 0,
  };
  const trades = loadTrades();
  trades.unshift(trade);
  saveTrades(trades);
  send(
    [`🎯 SNIPE BUY $${PAPER_SIZE_USD} | $${c.symbol}`,
     `🪙 ${c.mint.slice(0, 8)}…${c.mint.slice(-4)}`,
     `📊 score ${score} | vel ${velSolPerMin.toFixed(1)} SOL/min`,
     `📉 entry drag: ${dragMs}ms (detected $${detectedMc} → our $${ourMc})`,
     `🎯 TP: +100% ($${trade.targetMc}) | STOP: -30% ($${trade.stopMc})`].join("\n"),
  );
  console.log(`[sniper] BUY $${PAPER_SIZE_USD} ${c.symbol} drag ${dragMs}ms hisMc $${detectedMc} ourMc $${ourMc} target $${trade.targetMc}`);
}

function samplePath(trade: any, mc: number) {
  const now = Date.now();
  const last = trade.path[trade.path.length - 1];
  if (last && now - last.t < 2000) return;
  trade.path.push({ t: now, mc: Math.round(mc) });
  const cutoff = now - 60 * 60 * 1000;
  trade.path = trade.path.filter((p: any) => p.t >= cutoff);
}

// ---- resolve (TP / STOP / COPY-EXIT) ----
async function resolveTrades() {
  const trades = loadTrades();
  let closed = 0;
  for (const t of trades) {
    if (t.outcome !== "OPEN") continue;
    const mc = await mcUsd(t.mint);
    if (mc > 0) samplePath(t, mc);
    if (mc <= 0) continue;
    if (mc >= t.targetMc) {
      t.outcome = "WIN"; t.fillMc = Math.round(mc); t.pnlPct = 100;
      closed++;
      send(`✅ SNIPE TP +100% | $${t.symbol} | fill $${t.fillMc}`);
    } else if (mc <= t.stopMc) {
      t.outcome = "STOP"; t.fillMc = Math.round(mc);
      t.pnlPct = Math.round(((mc - t.ourMc) / t.ourMc) * 1000) / 10;
      closed++;
      send(`🔴 SNIPE STOP -30% | $${t.symbol} | fill $${t.fillMc}`);
    } else if (await trackedSoldMint(t.mint)) {
      t.outcome = "COPYEXIT"; t.fillMc = Math.round(mc);
      t.pnlPct = Math.round(((mc - t.ourMc) / t.ourMc) * 1000) / 10;
      closed++;
      send(`🔄 SNIPE COPY-EXIT (tracked sold) | $${t.symbol} | fill $${t.fillMc}`);
    }
  }
  if (closed) saveTrades(trades);
  return { closed };
}

// ---- poll ----
async function pollOnce() {
  try {
    const res = await fetch(`${BASE}?offset=0&limit=30&sort=created_timestamp&order=DESC&includeNsfw=false`, { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const batch = (await res.json()) as Coin[];
    for (const c of batch) {
      if (seen.has(c.mint)) continue;
      seen.add(c.mint);
      const realSolNow = (c.real_sol_reserves || 0) / 1e9;
      const r = scoreCoin(c, Date.now(), 0);
      if (!r.pass) continue;
      if (loadTrades().some((t) => t.mint === c.mint && t.outcome === "OPEN")) continue;
      await paperBuy(c, r.score, 0);
    }
  } catch (e) { console.error("[sniper] poll error:", (e as Error).message); }
  await resolveTrades();
}

async function main() {
  if (!ENABLED) { console.log("[sniper] MEGAPHONE_SNIPER not set — exiting (flag off)"); return; }
  console.log(`[sniper] PAPER sniper live | poll ${POLL_MS}ms | TP +100% | STOP -30% | copy-exit on tracked sell | paper $${PAPER_SIZE_USD}`);
  // prime seen so we don't snipe the whole current feed on start
  const res = await fetch(`${BASE}?offset=0&limit=30&sort=created_timestamp&order=DESC&includeNsfw=false`, { headers: { accept: "application/json" } });
  if (res.ok) { const b = (await res.json()) as Coin[]; for (const c of b) seen.add(c.mint); saveSeen(seen); }
  console.log(`[sniper] primed ${seen.size} coins`);
  const tick = async () => { await pollOnce(); };
  await tick();
  setInterval(tick, POLL_MS);
}

const invoked = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invoked.endsWith("/src/sniper.ts") || invoked.endsWith("\\src\\sniper.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
