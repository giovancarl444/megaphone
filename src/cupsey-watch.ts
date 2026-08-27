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
async function decodeTx(sig: string): Promise<{ mint?: string; sol?: number; side: string; wallet?: string }> {
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
    // fee payer (accs[0]) is the wallet that signed — catches sub-wallets
    const signer = accs[0] ?? WALLET;
    return { mint, sol: Math.round(sol * 1000) / 1000, side, wallet: signer };
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

function alertText(sig: string, blockTime: number, decoded: { mint?: string; sol?: number; side: string; wallet?: string }, detectedMs: number): string {
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

// ---- Telegram lifecycle messages (trade events) ----
function sendLife(text: string) {
  try {
    const tmp = path.join(DATA_DIR, `cupsey-life-${Date.now()}.txt`);
    writeFileSync(tmp, text, "utf8");
    execSync(`hermes send -t ${CALLOUT_CHAT} -f "${tmp}"`, { stdio: "ignore" });
    unlinkSync(tmp);
  } catch (e) {
    console.error("[cupsey-watch] life failed:", (e as Error).message);
  }
}

// ---- paper trade on alert ----
async function openPaperTrade(sig: string, decoded: { mint?: string; sol?: number; side: string }, wallet: string) {
  if (decoded.side !== "buy" || !decoded.mint) return; // only paper-buy his buys
  const mint = decoded.mint;
  const hisMc = await getMc(mint);
  await new Promise((r) => setTimeout(r, FILL_DELAY_MS));
  const ourMc = await getMc(mint);
  const dragPct = hisMc > 0 && ourMc > 0 ? Math.round(((ourMc - hisMc) / hisMc) * 1000) / 10 : 0;
  const trades = loadTrades();
  const trade = {
    sig,
    mint,
    wallet, // which of cupsey's wallets fired this
    sizeUsd: PAPER_SIZE_USD,
    hisMc: Math.round(hisMc),
    ourMc: Math.round(ourMc),
    entryDragPct: dragPct,
    targetMc: Math.round(ourMc * 2),
    stopMc: Math.round(ourMc * 0.7),
    fillDelayMs: FILL_DELAY_MS,
    openedAt: Date.now(),
    outcome: "OPEN",
    path: [] as { t: number; mc: number }[], // sampled every poll, 60min even after resolve
    triggerMc: 0,
    fillMc: 0,
  };
  trades.unshift(trade);
  saveTrades(trades);
  sendLife(
    [
      `🟢 WE BUY $${PAPER_SIZE_USD}`,
      `🪙 ${mint.slice(0, 8)}…${mint.slice(-4)}`,
      `👛 wallet: ${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
      `⏱ delay: ${FILL_DELAY_MS}ms`,
      `📉 entry drag: ${dragPct}% (his $${trade.hisMc} → our $${trade.ourMc})`,
      `🎯 target: $${trade.targetMc} (+100%)`,
    ].join("\n"),
  );
  console.log(`[cupsey-watch] 📊 paper BUY $${PAPER_SIZE_USD} | hisMc $${trade.hisMc} -> ourMc $${trade.ourMc} (drag ${dragPct}%) | target $${trade.targetMc}`);
}

// sample path point (append if last point >2s ago, keep 60min)
function samplePath(trade: any, mc: number) {
  const now = Date.now();
  const last = trade.path[trade.path.length - 1];
  if (last && now - last.t < 2000) return; // don't oversample
  trade.path.push({ t: now, mc: Math.round(mc) });
  // trim to 60 min
  const cutoff = now - 60 * 60 * 1000;
  trade.path = trade.path.filter((p: any) => p.t >= cutoff);
}

// ---- resolve open trades against live mc ----
// HONEST FILLS: detect trigger at poll N (record triggerMc), fill at poll N+1 mc.
export async function resolveTrades(): Promise<{ closed: number; wins: number; stops: number }> {
  const trades = loadTrades();
  let closed = 0, wins = 0, stops = 0;
  for (const t of trades) {
    const mc = await getMc(t.mint);
    if (mc > 0) samplePath(t, mc);
    if (t.outcome !== "OPEN") continue;
    if (mc <= 0) continue;

    // already triggered previous poll? fill now at THIS mc (the real fill)
    if (t.pendingExit) {
      t.fillMc = Math.round(mc);
      t.outcome = t.pendingExit.side;
      t.exitMc = Math.round(mc);
      t.pnlPct = t.pendingExit.side === "WIN" ? 100 : -Math.round(((t.targetMc - mc) / t.targetMc) * 100);
      t.pendingExit = undefined;
      closed++;
      if (t.outcome === "WIN") wins++; else stops++;
      const pnl = t.outcome === "WIN" ? `+100% ($${(t.sizeUsd * 2).toFixed(0)})` : `fill ${t.pnlPct}% ($${Math.round(t.sizeUsd * (1 + t.pnlPct / 100))})`;
      sendLife(
        [
          t.outcome === "WIN" ? `✅ WE SELL +100%` : `🔴 WE SELL (STOP FILL)`,
          `🪙 ${t.mint.slice(0, 8)}…${t.mint.slice(-4)}`,
          `🎯 trigger mc: $${t.triggerMc}`,
          `💵 fill mc: $${t.fillMc} → ${pnl}`,
        ].join("\n"),
      );
      sendLife(
        [
          `📋 RESOLUTION`,
          `🪙 ${t.mint.slice(0, 8)}…${t.mint.slice(-4)}`,
          `👛 ${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}`,
          `💰 size: $${t.sizeUsd}`,
          `📈 entry: his $${t.hisMc} → our $${t.ourMc} (drag ${t.entryDragPct}%)`,
          `🎯 trigger mc: $${t.triggerMc}`,
          `💵 fill mc: $${t.fillMc}`,
          `📊 PnL: ${pnl}`,
          `🧮 path samples: ${t.path.length}`,
        ].join("\n"),
      );
      console.log(`[cupsey-watch] 🏁 ${t.outcome} $${t.mint.slice(0, 8)} trigger $${t.triggerMc} fill $${t.fillMc}`);
      continue;
    }

    // detect trigger this poll (don't fill yet — next poll fills)
    if (mc >= t.targetMc) {
      t.pendingExit = { side: "WIN", triggerMc: Math.round(mc) };
      t.triggerMc = Math.round(mc);
    } else if (mc <= t.stopMc) {
      t.pendingExit = { side: "STOP", triggerMc: Math.round(mc) };
      t.triggerMc = Math.round(mc);
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
    if (decoded.side === "buy") {
      await openPaperTrade(s.sig, decoded, decoded.wallet ?? WALLET);
    } else if (decoded.side === "sell/other") {
      // CUPSY SELLS — info note only, does NOT trigger our exit
      sendLife(
        [
          `🔔 CUPSY SELLS (note)`,
          `🪙 ${decoded.mint ? decoded.mint.slice(0, 8) + "…" + decoded.mint.slice(-4) : "unknown"}`,
          `ℹ️ info only — we hold to our +100% rule`,
        ].join("\n"),
      );
    }
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
