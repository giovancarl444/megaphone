/**
 * cupsey-watch — single-whale alert watcher + paper-trader.
 *
 * Target: cupsey wallet 6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP
 *
 * 1. Poll his Solana wallet signatures (public RPC) every CUPSY_POLL_MS.
 * 2. On a NEW signature: decode the tx (mint + side + SOL amount),
 *    send an instant Telegram alert to CALLOUT_CHAT with exact time + latency.
 * 3. Open a paper trade: $100 buy, target +100% / stop -30%, simulate
 *    realistic latency (fill delay) so it behaves like real money.
 *
 * Run:
 *   tsx src/cupsey-watch.ts            -> loop forever
 *   tsx src/cupsey-watch.ts --once     -> one poll + report
 *   tsx src/cupsey-watch.ts --selftest -> one test alert
 */

import { execSync } from "node:child_process";
import { promises as fs, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";
import { CALLOUT_CHAT } from "./config";

const WALLET = "6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const SEEN_FILE = path.join(DATA_DIR, "cupsey-seen.json");
const TRADE_FILE = path.join(DATA_DIR, "cupsey-trades.json");
const POLL_MS = Number(process.env.CUPSY_POLL_MS ?? 8_000);
const RPC = process.env.CUPSY_RPC ?? "https://solana-rpc.publicnode.com";
const PAPER_SIZE_USD = Number(process.env.CUPSY_PAPER_USD ?? 100);
const FILL_DELAY_MS = Number(process.env.CUPSY_FILL_MS ?? 800); // simulated execution latency

// ---- persistence ----
function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(SEEN_FILE, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  fs.writeFile(SEEN_FILE, JSON.stringify([...seen], null, 2)).catch(() => {});
}
function loadTrades(): any[] {
  try {
    return JSON.parse(readFileSync(TRADE_FILE, "utf8")) as any[];
  } catch {
    return [];
  }
}
function saveTrades(t: any[]) {
  fs.writeFile(TRADE_FILE, JSON.stringify(t, null, 2)).catch(() => {});
}

// ---- RPC ----
async function rpc(method: string, params: any): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { result?: any };
  return j.result ?? null;
}

async function getMc(mint: string): Promise<number> {
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return 0;
    const j = (await res.json()) as any;
    return Number(j?.market_cap ?? j?.usd_market_cap ?? 0);
  } catch {
    return 0;
  }
}

async function getSignatures(limit = 5): Promise<{ sig: string; blockTime: number }[]> {
  const r = await rpc("getSignaturesForAddress", [WALLET, { limit }]);
  if (!r) return [];
  return r.map((s: any) => ({ sig: s.signature, blockTime: s.blockTime ?? 0 }));
}

// Pull the token mint + SOL amount from a tx. Best-effort decode.
async function decodeTx(sig: string): Promise<{ mint?: string; sol?: number; side: string }> {
  const tx = await rpc("getTransaction", [
    sig,
    { encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
  if (!tx) return { side: "unknown" };
  try {
    const msg = tx.transaction.message;
    const accs: string[] = msg.accountKeys ?? [];
    // find pump.fun program index
    const pfIdx = accs.indexOf(PUMP_PROGRAM);
    // mint is typically a later account in pump.fun buy instructions
    let mint: string | undefined;
    for (const a of accs) {
      // crude: mints are 32-44 char base58, skip known programs/wallet
      if (a.length >= 32 && a !== WALLET && a !== PUMP_PROGRAM) {
        mint = a;
        break;
      }
    }
    // SOL amount: scan balance changes for our wallet
    const meta = tx.meta ?? {};
    const pre = meta.preBalances ?? [];
    const post = meta.postBalances ?? [];
    const wIdx = accs.indexOf(WALLET);
    let sol = 0;
    if (wIdx >= 0 && pre[wIdx] != null) sol = Math.abs(post[wIdx] - pre[wIdx]) / 1e9;
    const side = sol > 0 && post[wIdx] < pre[wIdx] ? "buy" : "sell/other";
    return { mint, sol: Math.round(sol * 1000) / 1000, side };
  } catch {
    return { side: "unknown" };
  }
}

// ---- Telegram ----
function sendAlert(text: string) {
  try {
    const tmp = path.join(DATA_DIR, `cupsey-alert-${Date.now()}.txt`);
    writeFileSync(tmp, text, "utf8");
    execSync(`hermes send -t ${CALLOUT_CHAT} -f "${tmp}"`, { stdio: "ignore" });
    unlinkSync(tmp);
    console.log(`[cupsey-watch] 🔔 alert sent -> ${CALLOUT_CHAT}`);
  } catch (e) {
    console.error("[cupsey-watch] alert failed:", (e as Error).message);
  }
}

function alertText(sig: string, blockTime: number, decoded: { mint?: string; sol?: number; side: string }, detectedMs: number): string {
  const t = new Date(blockTime * 1000).toISOString().slice(11, 23); // HH:mm:ss.mmm
  const now = new Date();
  const latMs = now.getTime() - blockTime * 1000;
  const side = decoded.side === "buy" ? "BUY 🟢" : decoded.side === "sell/other" ? "SELL 🔴" : "MOVE";
  const lines = [
    `🔔 CUPSY ${side}`,
    `💎 wallet: ${WALLET.slice(0, 6)}…${WALLET.slice(-4)}`,
  ];
  if (decoded.mint) lines.push(`🪙 token: ${decoded.mint.slice(0, 8)}…${decoded.mint.slice(-4)}`);
  if (decoded.sol) lines.push(`💰 ${decoded.sol} SOL`);
  lines.push(`⏱ block: ${t} UTC`);
  lines.push(`⚡ latency: ${latMs >= 0 ? latMs : 0}ms (detected ${now.toISOString().slice(11, 23)})`);
  return lines.join("\n");
}

// ---- paper trade on alert ----
async function openPaperTrade(sig: string, decoded: { mint?: string; sol?: number; side: string }) {
  if (decoded.side !== "buy" || !decoded.mint) return; // only paper-buy his buys
  const mint = decoded.mint;
  // HIS entry mc: at his tx block time (as close as we can get — immediate fetch)
  const hisMc = await getMc(mint);
  // simulate our fill delay, THEN capture OUR entry mc (the latency drag)
  await new Promise((r) => setTimeout(r, FILL_DELAY_MS));
  const ourMc = await getMc(mint);
  const trades = loadTrades();
  const trade = {
    sig,
    mint,
    sizeUsd: PAPER_SIZE_USD,
    hisMc: Math.round(hisMc),
    ourMc: Math.round(ourMc),
    entryDragPct: hisMc > 0 && ourMc > 0 ? Math.round(((ourMc - hisMc) / hisMc) * 1000) / 10 : 0,
    targetMc: Math.round(ourMc * 2), // +100% on OUR entry
    stopMc: Math.round(ourMc * 0.7), // -30% on OUR entry
    fillDelayMs: FILL_DELAY_MS,
    openedAt: Date.now(),
    outcome: "OPEN",
  };
  trades.unshift(trade);
  saveTrades(trades);
  console.log(`[cupsey-watch] 📊 paper BUY $${PAPER_SIZE_USD} | hisMc $${trade.hisMc} -> ourMc $${trade.ourMc} (drag ${trade.entryDragPct}%) | target $${trade.targetMc}`);
}

// ---- resolve open trades against live mc ----
export async function resolveTrades(): Promise<{ closed: number; wins: number; stops: number }> {
  const trades = loadTrades();
  let closed = 0, wins = 0, stops = 0;
  for (const t of trades) {
    if (t.outcome !== "OPEN") continue;
    const mc = await getMc(t.mint);
    if (mc <= 0) continue;
    if (mc >= t.targetMc) {
      t.outcome = "WIN"; t.exitMc = Math.round(mc); t.pnlPct = 100;
      closed++; wins++;
      console.log(`[cupsey-watch] 🏁 WIN $${t.mint.slice(0, 8)} +100% (mc $${t.exitMc})`);
    } else if (mc <= t.stopMc) {
      t.outcome = "STOP"; t.exitMc = Math.round(mc); t.pnlPct = -30;
      closed++; stops++;
      console.log(`[cupsey-watch] 🛑 STOP $${t.mint.slice(0, 8)} -30% (mc $${t.exitMc})`);
    }
  }
  saveTrades(trades);
  return { closed, wins, stops };
}

// ---- poll ----
export async function pollOnce(): Promise<{ scanned: number; newAlerts: number }> {
  const sigs = await getSignatures(5);
  const seen = loadSeen();
  let newAlerts = 0;
  for (const s of sigs) {
    if (seen.has(s.sig)) continue;
    seen.add(s.sig);
    newAlerts++;
    const t0 = Date.now();
    const decoded = await decodeTx(s.sig);
    const text = alertText(s.sig, s.blockTime, decoded, t0);
    sendAlert(text);
    await openPaperTrade(s.sig, decoded);
  }
  saveSeen(seen);
  // resolve any open paper trades against live mc
  await resolveTrades();
  return { scanned: sigs.length, newAlerts };
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--selftest") {
    sendAlert(
      [
        "🧪 CUPSY-WATCH LIVE",
        "💎 wallet: 6DQAGJ…dbqQqqP",
        "⏱ selftest " + new Date().toISOString().slice(11, 23),
        "🔗 solscan: https://solscan.io/account/" + WALLET,
      ].join("\n"),
    );
    return;
  }
  if (arg === "--once") {
    const r = await pollOnce();
    console.log("[cupsey-watch] one-shot:", JSON.stringify(r));
    return;
  }
  console.log(`[cupsey-watch] looping every ${POLL_MS / 1000}s | wallet ${WALLET.slice(0, 6)}… | -> ${CALLOUT_CHAT} | paper $${PAPER_SIZE_USD}`);
  const tick = async () => {
    const r = await pollOnce();
    if (r.newAlerts > 0) console.log(`[cupsey-watch] tick newAlerts=${r.newAlerts}`);
  };
  await tick();
  setInterval(tick, POLL_MS);
}

if (import.meta.url.replace(/\\/g, "/").endsWith("/src/cupsey-watch.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
