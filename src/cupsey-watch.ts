/**
 * cupsey-watch — single-whale alert watcher + paper-trader.
 *
 * Target: cupsey wallet 3tL1nfq5tb9RfydszNwMytYAZrnD3gpkmxxcdTvpPS6S
 *
 * CHAIN-NATIVE (no pump.fun API, no CF, no JWT):
 * 1. Poll his Solana wallet signatures (public RPC) every CUPSY_POLL_MS.
 * 2. On a NEW signature: decode the tx on-chain (mint + side + SOL),
 *    alert to CALLOUT_CHAT with exact time + latency.
 * 3. On BUY: open a paper trade ($100, +100%/-30%), start 60min path sampling.
 *
 * mc (market cap) is read best-effort from pump.fun /coins (CF-flaky);
 * trades open even if mc is pending, and target/stop are set once ourMc>0.
 *
 * Run:
 *   tsx src/cupsey-watch.ts            -> loop forever
 *   tsx src/cupsey-watch.ts --once     -> one poll + report
 *   tsx src/cupsey-watch.ts --selftest -> one test alert
 *   tsx src/cupsey-watch.ts --scan     -> print recent sigs + decoded sides (debug)
 */

import { execSync } from "node:child_process";
import { promises as fs, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";
import { CALLOUT_CHAT } from "./config";

const WALLET = "3tL1nfq5tb9RfydszNwMytYAZrnD3gpkmxxcdTvpPS6S";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const SEEN_FILE = path.join(DATA_DIR, "cupsey-seen.json");
const TRADE_FILE = path.join(DATA_DIR, "cupsey-trades.json");
const LIVE_LOCK = path.join(DATA_DIR, "cupsey-watch.lock");
// Only txs at/after process start (or within 2min) are "fresh". Older sigs are
// backfill (e.g. after a seen-clear) and must NOT alert/trade/exit — especially
// with copy-exit live, a backfilled sell could wrongly close a real position.
const START_TIME = Date.now();
const FRESH_WINDOW_MS = 2 * 60 * 1000;
function isFresh(blockTime: number): boolean {
  if (!blockTime) return false;
  const btMs = blockTime * 1000;
  if (btMs < START_TIME) return false; // before we started → backfill, ignore
  const ageMs = Date.now() - btMs;
  return ageMs <= FRESH_WINDOW_MS;
}
const POLL_MS = Number(process.env.CUPSY_POLL_MS ?? 8_000);
const RPC = process.env.CUPSY_RPC ?? "https://api.mainnet-beta.solana.com";
const RPC_FALLBACK = "https://solana-rpc.publicnode.com";
const PAPER_SIZE_USD = Number(process.env.CUPSY_PAPER_USD ?? 100);
const FILL_DELAY_MS = Number(process.env.CUPSY_FILL_MS ?? 800); // simulated execution latency

// ---- persistence (atomic, serialized — Windows: concurrent rename over an
// open file fails, and two watcher instances were wiping the file) ----
function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(SEEN_FILE, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}
let seenChain: Promise<void> = Promise.resolve();
function saveSeen(seen: Set<string>): void {
  const run = async () => {
    const tmp = SEEN_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify([...seen], null, 2));
    for (let i = 0; i < 5; i++) {
      try { await fs.rename(tmp, SEEN_FILE); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    await fs.writeFile(SEEN_FILE, JSON.stringify([...seen], null, 2));
  };
  seenChain = seenChain.then(run, run);
}
function loadTrades(): any[] {
  try {
    return JSON.parse(readFileSync(TRADE_FILE, "utf8")) as any[];
  } catch {
    return [];
  }
}
let tradeChain: Promise<void> = Promise.resolve();
function saveTrades(t: any[]): void {
  const run = async () => {
    const tmp = TRADE_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(t, null, 2));
    for (let i = 0; i < 5; i++) {
      try { await fs.rename(tmp, TRADE_FILE); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    await fs.writeFile(TRADE_FILE, JSON.stringify(t, null, 2));
  };
  tradeChain = tradeChain.then(run, run);
}

// ---- RPC ---- (tries primary, falls back if null/empty) ----
async function rpc(method: string, params: any): Promise<any> {
  for (const url of [RPC, RPC_FALLBACK]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { result?: any };
      if (j.result != null) return j.result;
    } catch {
      continue;
    }
  }
  return null;
}

// Canonical mc source -> always USD (matches usd_market_cap convention used by
// paper-scalp / resolve-loop / score). Primary: pump.fun public GET /coins
// (usd_market_cap, no auth, no CF cookie needed). Fallback: on-chain bonding
// curve read (chain-native, CF-proof) so the watcher still works if the API blips.
async function mcUsd(mint: string): Promise<number> {
  // 1) pump.fun public read (usd_market_cap is the USD field; market_cap is SOL)
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const j = (await res.json()) as any;
      const usd = Number(j?.usd_market_cap ?? 0);
      if (usd > 0) return Math.round(usd);
    }
  } catch { /* fall through to chain */ }
  // 2) on-chain fallback: read the pump.fun bonding-curve account.
  try {
    const PROG = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
    const { PublicKey } = await import("@solana/web3.js");
    const mintPk = new PublicKey(mint);
    const [curve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintPk.toBuffer()],
      new PublicKey(PROG),
    );
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [curve.toBase58(), { encoding: "base64" }],
      }),
    });
    const j = (await res.json()) as any;
    const b64 = j?.result?.value?.data?.[0];
    if (!b64) return 0;
    const buf = Buffer.from(b64, "base64");
    // Anchor discriminator (8 bytes) precedes the fields:
    // vToken@8 vSol@16 rToken@24 rSol@32 supply@40  (all u64, lamports / 1e6 units)
    const readU64 = (off: number) => buf.readUInt32LE(off) + buf.readUInt32LE(off + 4) * 2 ** 32;
    const vToken = readU64(8);
    const vSol = readU64(16);
    const rToken = readU64(24);
    const rSol = readU64(32);
    const totalSupply = readU64(40);
    if (vToken <= rToken) return 0;
    // price (SOL per token) = (vSol - rSol)/1e9 / ((vToken - rToken)/1e6)
    const priceSol = (vSol - rSol) / 1e9 / ((vToken - rToken) / 1e6);
    const mcSol = priceSol * (totalSupply / 1e6); // total tokens = supply/1e6
    const SOL_USD = 200;
    return Math.round(mcSol * SOL_USD);
  } catch {
    return 0;
  }
}

async function getSignatures(limit = 5): Promise<{ sig: string; blockTime: number }[]> {
  const r = await rpc("getSignaturesForAddress", [WALLET, { limit }]);
  if (!r) return [];
  return r.map((s: any) => ({ sig: s.signature, blockTime: s.blockTime ?? 0 }));
}

const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// Deterministically find the token mint of a pump.fun tx: locate the instruction
// that calls PUMP_PROGRAM, take its account list, and return the first account
// whose on-chain owner is the SPL token program (a mint account). No API guessing.
async function resolveMint(tx: any): Promise<string | undefined> {
  try {
    const msg = tx.transaction.message;
    const accs: string[] = msg.accountKeys ?? [];
    const ixns = msg.instructions ?? [];
    const pfIxn = ixns.find((ix: any) => accs[ix.programIdIndex] === PUMP_PROGRAM);
    if (!pfIxn) return undefined;
    const acctIdxs: number[] = pfIxn.accounts ?? [];
    const candidates = acctIdxs.map((i: number) => accs[i]).filter(Boolean);
    // batch owner check
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getMultipleAccountsInfo",
        params: [candidates, { encoding: "base64" }],
      }),
    });
    const j = (await res.json()) as any;
    const infos = j?.result?.value ?? [];
    for (let i = 0; i < candidates.length; i++) {
      const owner = infos[i]?.owner;
      const dataLen = infos[i]?.data?.[0] ? Buffer.from(infos[i].data[0], "base64").length : 0;
      if (owner === SPL_TOKEN && dataLen === 82) return candidates[i]; // 82 = mint account
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Pull the token mint + SOL amount from a tx. Best-effort decode.
async function decodeTx(sig: string): Promise<{ mint?: string; mintCandidates?: string[]; sol?: number; side: string; wallet?: string }> {
  const tx = await rpc("getTransaction", [
    sig,
    { encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
  if (!tx) return { side: "unknown" };
  try {
    const msg = tx.transaction.message;
    const accs: string[] = msg.accountKeys ?? [];
    // candidate mints: valid base58, 32-44 chars, not wallet/program
    const cands = accs.filter(
      (a: string) => a.length >= 32 && a.length <= 44 && a !== WALLET && a !== PUMP_PROGRAM,
    );
    const mint = await resolveMint(tx); // deterministic: pump.fun instruction → SPL mint
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
    return { mint: mint ?? cands[0], mintCandidates: cands, sol: Math.round(sol * 1000) / 1000, side, wallet: signer };
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
  const backfill = latMs > 10 * 60 * 1000; // >10min old = backfill, not a live catch
  const side = decoded.side === "buy" ? "BUY 🟢" : decoded.side === "sell/other" ? "SELL 🔴" : "MOVE";
  const lines = [
    `🔔 CUPSY ${side}`,
    `💎 wallet: ${WALLET.slice(0, 6)}…${WALLET.slice(-4)}`,
  ];
  if (decoded.mint) lines.push(`🪙 token: ${decoded.mint.slice(0, 8)}…${decoded.mint.slice(-4)}`);
  if (decoded.sol) lines.push(`💰 ${decoded.sol} SOL`);
  lines.push(`⏱ block: ${t} UTC`);
  lines.push(backfill ? `⚠️ BACKFILL (${Math.round(latMs / 60000)}min old) — no trade/exit` : `⚡ latency: ${latMs >= 0 ? latMs : 0}ms (detected ${now.toISOString().slice(11, 23)})`);
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
async function openPaperTrade(sig: string, decoded: { mint?: string; sol?: number; side: string; wallet?: string }, wallet: string) {
  if (decoded.side !== "buy" || !decoded.mint) return; // only paper-buy his buys
  const mint = decoded.mint;
  const hisMc = await mcUsd(mint);
  await new Promise((r) => setTimeout(r, FILL_DELAY_MS));
  const ourMc = await mcUsd(mint);
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
    // target/stop only set once we have a real ourMc; until then mcPending
    targetMc: ourMc > 0 ? Math.round(ourMc * 2) : 0,
    stopMc: ourMc > 0 ? Math.round(ourMc * 0.7) : 0,
    mcPending: ourMc <= 0,
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
      ourMc > 0
        ? `📉 entry drag: ${dragPct}% (his $${trade.hisMc} → our $${trade.ourMc})`
        : `⏳ mc pending (pump.fun read failed, will fill on first success)`,
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

// Mark any OPEN trade on `mint` to exit on the next poll (copy-exit on his sell).
function markCopyExit(mint: string): void {
  const trades = loadTrades();
  let changed = false;
  for (const t of trades) {
    if (t.outcome === "OPEN" && t.mint === mint && !t.pendingExit) {
      t.pendingExit = { side: "HISSELL", triggerMc: 0 }; // fill at next live mc
      changed = true;
    }
  }
  if (changed) saveTrades(trades);
}

// ---- resolve open trades against live mc ----
// HONEST FILLS: detect trigger at poll N (record triggerMc), fill at poll N+1 mc.
export async function resolveTrades(): Promise<{ closed: number; wins: number; stops: number }> {
  const trades = loadTrades();
  let closed = 0, wins = 0, stops = 0;
  for (const t of trades) {
    const mc = await mcUsd(t.mint);
    if (mc > 0) samplePath(t, mc);
    if (t.outcome !== "OPEN") continue;
    if (mc <= 0) continue;
    // if mc was pending and we just got a real read, set targets now
    if (t.mcPending && mc > 0) {
      t.mcPending = false;
      t.ourMc = Math.round(mc);
      t.targetMc = Math.round(mc * 2);
      t.stopMc = Math.round(mc * 0.7);
      t.entryDragPct = t.hisMc > 0 ? Math.round(((mc - t.hisMc) / t.hisMc) * 1000) / 10 : 0;
    }
    if (t.mcPending) continue; // don't trigger until we have a real ourMc

    // already triggered previous poll? fill now at THIS mc (the real fill)
    if (t.pendingExit) {
      t.fillMc = Math.round(mc);
      t.exitMc = Math.round(mc);
      const side = t.pendingExit.side;
      t.outcome = side; // WIN | STOP | HISSELL
      // HONEST pnl: measured from OUR entry to the real fill, in USD.
      // WIN target is +100% (fillMc >= 2x ourMc). STOP/HISSELL book the true
      // fill pnl (can be + or -, e.g. he dumped at -50 → we log -50).
      t.pnlPct =
        side === "WIN"
          ? Math.round(((mc - t.ourMc) / t.ourMc) * 1000) / 10
          : -Math.round(((t.ourMc - mc) / t.ourMc) * 1000) / 10;
      t.pendingExit = undefined;
      closed++;
      if (side === "WIN") wins++;
      else if (side === "STOP") stops++;
      const pnl =
        side === "WIN"
          ? `+100% ($${(t.sizeUsd * 2).toFixed(0)})`
          : `fill ${t.pnlPct}% ($${Math.round(t.sizeUsd * (1 + t.pnlPct / 100))})`;
      const label =
        side === "WIN" ? "✅ WE SELL +100%" : side === "HISSELL" ? "🔄 WE SELL (COPY-EXIT)" : "🔴 WE SELL (STOP FILL)";
      sendLife(
        [
          label,
          `🪙 ${t.mint.slice(0, 8)}…${t.mint.slice(-4)}`,
          side === "HISSELL" ? `ℹ️ copy-exit: he sold, we followed` : `🎯 trigger mc: $${t.triggerMc}`,
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
          side === "HISSELL" ? `🔄 exit: COPY-EXIT (his sell)` : `🎯 trigger mc: $${t.triggerMc}`,
          `💵 fill mc: $${t.fillMc}`,
          `📊 PnL: ${pnl}`,
          `🧮 path samples: ${t.path.length}`,
        ].join("\n"),
      );
      console.log(`[cupsey-watch] 🏁 ${side} $${t.mint.slice(0, 8)} trigger $${t.triggerMc} fill $${t.fillMc} pnl ${t.pnlPct}%`);
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
export async function pollOnce(readOnly = false): Promise<{ scanned: number; newAlerts: number }> {
  const sigs = await getSignatures(25);
  const seen = loadSeen();
  let newAlerts = 0;
  for (const s of sigs) {
    if (seen.has(s.sig)) continue;
    seen.add(s.sig);
    // FRESHNESS GATE: backfill (blockTime before start, or >2min old) is
    // recorded as seen but NEVER alerted/traded/exited. With copy-exit live,
    // a backfilled sell must not touch a real position.
    if (!isFresh(s.blockTime)) {
      console.log(`[cupsey-watch] ⏭ backfill skipped (block ${new Date(s.blockTime * 1000).toISOString().slice(11, 16)} UTC) sig ${s.sig.slice(0, 10)}`);
      continue;
    }
    newAlerts++;
    if (readOnly) continue; // --once while live watcher holds the lock: no alerts/trades
    const t0 = Date.now();
    const decoded = await decodeTx(s.sig);
    const text = alertText(s.sig, s.blockTime, decoded, t0);
    sendAlert(text);
    if (decoded.side === "buy") {
      await openPaperTrade(s.sig, decoded, decoded.wallet ?? WALLET);
    } else if (decoded.side === "sell/other") {
      // CUPSY SELLS — we COPY his exit: mark our open trade on this mint to
      // close at the next poll's live mc. Rule (founder, 00:1x): if he sells,
      // we sell — no matter what. Still record +100% path data for replay.
      const mint = decoded.mint;
      if (mint) markCopyExit(mint);
      sendLife(
        [
          `🔔 CUPSY SELLS → WE EXIT`,
          `🪙 ${mint ? mint.slice(0, 8) + "…" + mint.slice(-4) : "unknown"}`,
          `ℹ️ copy-exit armed — closing our position at next live fill`,
        ].join("\n"),
      );
    }
  }
  saveSeen(seen);
  if (!readOnly) await resolveTrades();
  return { scanned: sigs.length, newAlerts };
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--selftest") {
    sendAlert(
      [
        "🧪 CUPSY-WATCH LIVE",
        "💎 wallet: 3tL1nf…PS6S",
        "⏱ selftest " + new Date().toISOString().slice(11, 23),
        "🔗 solscan: https://solscan.io/account/" + WALLET,
      ].join("\n"),
    );
    return;
  }
  // --once / --scan must NEVER alert or open trades while the live watcher
  // holds the lock. They become read-only previews.
  const liveRunning = (() => { try { return readFileSync(LIVE_LOCK, "utf8").trim().length > 0; } catch { return false; } })();
  if (arg === "--once") {
    const r = await pollOnce(liveRunning);
    console.log("[cupsey-watch] one-shot (readOnly=" + liveRunning + "):", JSON.stringify(r));
    return;
  }
  if (arg === "--scan") {
    const sigs = await getSignatures(10);
    console.log(`[scan] wallet ${WALLET.slice(0, 6)}… | ${sigs.length} recent sigs`);
    for (const s of sigs) {
      const d = await decodeTx(s.sig);
      console.log(`  ${s.sig.slice(0, 10)} side=${d.side} mint=${d.mint ? d.mint.slice(0, 8) : "-"} sol=${d.sol ?? "-"} wallet=${d.wallet ? d.wallet.slice(0, 6) : "-"}`);
    }
    return;
  }
  // loop mode: take the lock so --once/--scan can't double-write
  writeFileSync(LIVE_LOCK, String(process.pid), "utf8");
  const releaseLock = () => { try { unlinkSync(LIVE_LOCK); } catch {} };
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(0); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(0); });
  console.log(`[cupsey-watch] looping every ${POLL_MS / 1000}s | wallet ${WALLET.slice(0, 6)}… | -> ${CALLOUT_CHAT} | paper $${PAPER_SIZE_USD} | lock pid ${process.pid}`);
  // PRIME seen from current chain state WITHOUT alerting/trading — prevents
  // replaying backfill (old blocks) as fresh signals on (re)start.
  const prime = await getSignatures(25);
  const seen0 = loadSeen();
  for (const s of prime) seen0.add(s.sig);
  saveSeen(seen0);
  console.log(`[cupsey-watch] primed seen with ${prime.length} existing sigs (no alerts)`);
  const tick = async () => {
    const r = await pollOnce(false);
    if (r.newAlerts > 0) console.log(`[cupsey-watch] tick newAlerts=${r.newAlerts}`);
  };
  await tick();
  setInterval(tick, POLL_MS);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("/src/cupsey-watch.ts") || invokedPath.endsWith("\\src\\cupsey-watch.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
