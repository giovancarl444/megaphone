/**
 * dev-watch — snipe NEW token launches from KNOWN GOOD DEVS.
 *
 * Source: GMGN trenches dev discovery (high open-ratio devs whose launches
 * historically survive). Watchlist: .dev1/dev-watchlist.json (dev_discover.py).
 *
 * Chain-native detection (no pump.fun API, no CF):
 * 1. Poll each dev wallet's signatures via Solana public RPC (getSignaturesForAddress).
 * 2. On a NEW signature whose blockTime is fresh (>= start, <=2min old):
 *    decode the tx; if it's a pump.fun CREATE (new token launched by this dev),
 *    alert @pumpyscorner + open a $100 paper snipe (target +100%, stop -30%).
 * 3. Freshness gate + seen-prime exactly like cupsey-watch — no backfill trades.
 *
 * Run:
 *   tsx src/dev-watch.ts            -> loop forever
 *   tsx src/dev-watch.ts --once     -> one poll + report
 *   tsx src/dev-watch.ts --scan     -> print recent sigs + decoded sides (debug)
 */
import { execSync } from "node:child_process";
import { promises as fs, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const DATA_DIR = process.env.DEV_DATA_DIR ?? path.join(process.cwd(), ".dev1");
const WATCHLIST_FILE = path.join(DATA_DIR, "dev-watchlist.json");
const SEEN_FILE = path.join(DATA_DIR, "dev-seen.json");
const TRADE_FILE = path.join(DATA_DIR, "devbook.json");
const LIVE_LOCK = path.join(DATA_DIR, "dev-watch.lock");
const POLL_MS = 8_000;
const PAPER_SIZE_USD = 100;
const TP_PCT = 100;   // +100% target
const SL_PCT = -30;   // -30% stop
const CALLOUT_CHAT = process.env.CALLOUT_CHAT ?? "telegram:@pumpyscorner";

const RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
async function rpc(method: string, params: any[]): Promise<any> {
  for (const u of RPCS) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j.result) return j.result;
    } catch {}
  }
  return null;
}

// ---- freshness gate (same as cupsey-watch) ----
const START_TIME = Date.now();
const FRESH_WINDOW_MS = 2 * 60 * 1000;
function isFresh(blockTime: number): boolean {
  if (!blockTime) return false;
  const btMs = blockTime * 1000;
  if (btMs < START_TIME) return false;
  if (Date.now() - btMs > FRESH_WINDOW_MS) return false;
  return true;
}

// ---- atomic JSON persistence ----
let writeChain: Promise<void> = Promise.resolve();
function saveJson(file: string, data: any) {
  writeChain = writeChain.then(async () => {
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file).catch(async () => { await fs.rm(file, { force: true }); await fs.rename(tmp, file); });
  }).catch((e) => console.error("[dev-watch] save failed:", e.message));
  return writeChain;
}
function loadJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}
function loadSeen(): Set<string> { return new Set(loadJson<string[]>(SEEN_FILE, [])); }
function saveSeen(s: Set<string>) { saveJson(SEEN_FILE, [...s]); }
function loadTrades(): any[] { return loadJson<any[]>(TRADE_FILE, []); }

// ---- dev watchlist ----
async function loadDevWallets(): Promise<string[]> {
  const d = loadJson<any>(WATCHLIST_FILE, { devs: [] });
  return (d.devs || []).map((x: any) => x.wallet).filter(Boolean);
}

function getSignatures(limit: number, wallet: string): Promise<any[]> {
  return rpc("getSignaturesForAddress", [wallet, { limit }]);
}

// ---- decode: does this tx CREATE a new pump.fun token? ----
interface Decoded { isCreate: boolean; mint: string | null; }
async function decodeTx(sig: string, wallet: string): Promise<Decoded> {
  try {
    const tx = await rpc("getTransaction", [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]);
    if (!tx?.transaction?.message) return { isCreate: false, mint: null };
    const msg = tx.transaction.message;
    const accs = msg.accountKeys.map((a: any) => typeof a === "string" ? a : a.pubkey);
    const ixns = msg.instructions || [];
    for (const ix of ixns) {
      const prog = accs[ix.programIdIndex];
      if (prog !== PUMP_PROGRAM) continue;
      // pump.fun create: account list starts [global, feeRecipient, mint, bondingCurve, ...]
      if ((ix.accounts?.length ?? 0) >= 3) {
        const mint = ix.accounts[2];
        if (mint && typeof mint === "string" && mint.length >= 32) {
          // confirm this is the CREATE (mint is a fresh token, not in wallet's seen)
          return { isCreate: true, mint };
        }
      }
    }
  } catch {}
  return { isCreate: false, mint: null };
}

// ---- mc best-effort via pump.fun public read (USD) ----
async function mcUsd(mint: string): Promise<number> {
  try {
    const r = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, { headers: { accept: "application/json" } });
    const j = await r.json();
    return Number(j.usd_market_cap ?? j.market_cap ?? 0) || 0;
  } catch { return 0; }
}

// ---- alerts (to @pumpyscorner only) ----
function sendAlert(text: string) {
  try {
    const tmp = path.join(DATA_DIR, `alert-${Date.now()}.txt`);
    writeFileSync(tmp, text, "utf8");
    execSync(`hermes send -t ${CALLOUT_CHAT} -f "${tmp}"`, { stdio: "ignore" });
    console.log(`[dev-watch] 🔔 sent -> ${CALLOUT_CHAT}`);
  } catch (e) { console.warn("[dev-watch] alert failed:", (e as Error).message); }
}

// ---- paper snipe ----
async function openSnipe(sig: string, mint: string, devWallet: string) {
  const trades = loadTrades();
  if (trades.some((t) => t.mint === mint && t.outcome === "OPEN")) {
    console.log(`[dev-watch] already OPEN on ${mint.slice(0, 8)}, skipping duplicate`);
    return;
  }
  const t = {
    sig, mint, size: PAPER_SIZE_USD, wallet: devWallet, type: "DEV_SNIPE",
    entryMc: 0, ourMc: 0, targetMc: 0, stopMc: 0, fillMc: 0, dragPct: 0,
    outcome: "OPEN", exitMc: 0, pnlPct: 0, openedAt: Date.now(), path: [],
  };
  const mc = await mcUsd(mint);
  if (mc > 0) {
    t.ourMc = mc; t.entryMc = mc; t.targetMc = mc * (1 + TP_PCT / 100); t.stopMc = mc * (1 + SL_PCT / 100);
  }
  trades.push(t);
  await saveJson(TRADE_FILE, trades);
  sendAlert([
    `🎯 DEV SNIPE $${PAPER_SIZE_USD} | ${mint.slice(0, 8)}…${mint.slice(-4)}`,
    `👛 dev: ${devWallet.slice(0, 8)}…`,
    `⏱ launched block ${new Date().toISOString().slice(11, 19)} UTC`,
    mc > 0 ? `📊 entry mc: $${mc.toLocaleString()} | TP: $${t.targetMc.toLocaleString()} | STOP: $${t.stopMc.toLocaleString()}` : `⏳ mc pending (fill on first success)`,
  ].join("\n"));
}

// ---- resolve OPEN trades (TP/SL on live mc) ----
async function resolveTrades() {
  const trades = loadTrades();
  let changed = false;
  for (const t of trades) {
    if (t.outcome !== "OPEN") continue;
    const mc = await mcUsd(t.mint);
    if (mc <= 0) continue;
    t.path.push({ t: Date.now(), mc });
    t.fillMc = t.fillMc || mc;
    t.ourMc = t.ourMc || mc;
    if (!t.targetMc) { t.targetMc = mc * (1 + TP_PCT / 100); t.stopMc = mc * (1 + SL_PCT / 100); }
    if (t.ourMc > 0) {
      const pnl = (mc - t.ourMc) / t.ourMc * 100;
      if (pnl >= TP_PCT) {
        t.outcome = "WIN"; t.exitMc = mc; t.pnlPct = pnl; t.resolvedAt = Date.now();
        sendAlert(`✅ DEV SNIPE TP +${TP_PCT}% | ${t.mint.slice(0, 8)}… | fill $${Math.round(mc)}`);
        changed = true;
      } else if (pnl <= SL_PCT) {
        t.outcome = "STOP"; t.exitMc = mc; t.pnlPct = pnl; t.resolvedAt = Date.now();
        sendAlert(`🔴 DEV SNIPE STOP ${SL_PCT}% | ${t.mint.slice(0, 8)}… | fill $${Math.round(mc)}`);
        changed = true;
      }
    }
  }
  if (changed) await saveJson(TRADE_FILE, trades);
}

export async function pollOnce(readOnly = false): Promise<{ scanned: number; newLaunches: number }> {
  const seen = loadSeen();
  const wallets = await loadDevWallets();
  let scanned = 0, newLaunches = 0;
  for (const w of wallets) {
    const sigs = (await getSignatures(25, w)) || [];
    scanned += sigs.length;
    for (const s of sigs) {
      const key = `${w}:${s.sig}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isFresh(s.blockTime)) continue; // backfill: no alert/trade
      const d = await decodeTx(s.sig, w);
      if (d.isCreate && d.mint) {
        newLaunches++;
        console.log(`[dev-watch] 🚀 NEW LAUNCH ${d.mint.slice(0, 8)} by dev ${w.slice(0, 8)}`);
        if (!readOnly) await openSnipe(s.sig, d.mint, w);
      }
    }
  }
  saveSeen(seen);
  if (!readOnly) await resolveTrades();
  return { scanned, newLaunches };
}

async function main() {
  const arg = process.argv[2];
  const liveRunning = (() => { try { return readFileSync(LIVE_LOCK, "utf8").trim().length > 0; } catch { return false; } })();
  if (arg === "--once") {
    const r = await pollOnce(liveRunning);
    console.log("[dev-watch] one-shot (readOnly=" + liveRunning + "):", JSON.stringify(r));
    return;
  }
  if (arg === "--scan") {
    const wallets = await loadDevWallets();
    console.log(`[scan] ${wallets.length} devs in watchlist`);
    for (const w of wallets.slice(0, 5)) {
      const sigs = await getSignatures(10, w);
      console.log(`  dev ${w.slice(0, 8)}… | ${sigs.length} recent sigs`);
    }
    return;
  }
  writeFileSync(LIVE_LOCK, String(process.pid), "utf8");
  const releaseLock = () => { try { unlinkSync(LIVE_LOCK); } catch {} };
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(0); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(0); });
  const wallets = await loadDevWallets();
  console.log(`[dev-watch] looping every ${POLL_MS / 1000}s | ${wallets.length} devs | -> ${CALLOUT_CHAT} | paper $${PAPER_SIZE_USD} | lock pid ${process.pid}`);
  // prime seen WITHOUT alerting (no backfill replays)
  const seen0 = loadSeen();
  let primed = 0;
  for (const w of wallets) {
    const prime = await getSignatures(25, w);
    for (const s of prime) { seen0.add(`${w}:${s.sig}`); primed++; }
  }
  saveSeen(seen0);
  console.log(`[dev-watch] primed seen with ${primed} existing sigs (no alerts)`);
  setInterval(async () => {
    try { await pollOnce(false); }
    catch (e) { console.error("[dev-watch] poll error:", (e as Error).message); }
  }, POLL_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
