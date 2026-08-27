import { promises as fs } from "node:fs";
import path from "node:path";
import { recentCallouts, logCallout, Callout } from "./leaderboard";
import { fetchCoinNow } from "./whales";

const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const TRADES = path.join(DATA_DIR, "paper-trades.csv");

const TARGET_MULT = 2.0; // 100% return = 2x exit
const STOP_MULT = 0.7; // -30% stop
const MS_LATENCY = 800; // realistic buy/sell round-trip latency (ms)

interface PaperTrade {
  mint: string;
  symbol: string;
  entryUsd: number;
  targetUsd: number;
  exitUsd: number;
  exitMult: number;
  outcome: "WIN" | "STOP" | "OPEN" | "EXPIRED";
  enteredAt: number;
  exitedAt?: number;
}

export async function writeTrades(): Promise<void> {
  const trades = await loadTrades();
  const header = "mint,symbol,entryUsd,targetUsd,exitUsd,exitMult,outcome,enteredAt,exitedAt";
  const rows = trades.map((t) =>
    [t.mint, t.symbol, t.entryUsd, t.targetUsd, t.exitUsd, t.exitMult.toFixed(3), t.outcome, t.enteredAt, t.exitedAt ?? ""].join(","),
  );
  await fs.writeFile(TRADES, [header, ...rows].join("\n"), "utf8");
}

async function loadTrades(): Promise<PaperTrade[]> {
  try {
    const raw = await fs.readFile(TRADES, "utf8");
    const lines = raw.trim().split("\n").slice(1);
    return lines.map((l) => {
      const p = l.split(",");
      return {
        mint: p[0],
        symbol: p[1],
        entryUsd: +p[2],
        targetUsd: +p[3],
        exitUsd: +p[4],
        exitMult: +p[5],
        outcome: p[6] as PaperTrade["outcome"],
        enteredAt: +p[7],
        exitedAt: p[8] ? +p[8] : undefined,
      } as PaperTrade;
    });
  } catch {
    return [];
  }
}

async function saveTrade(t: PaperTrade): Promise<void> {
  const trades = await loadTrades();
  const idx = trades.findIndex((x) => x.mint === t.mint);
  if (idx >= 0) trades[idx] = t;
  else trades.push(t);
  const header = "mint,symbol,entryUsd,targetUsd,exitUsd,exitMult,outcome,enteredAt,exitedAt";
  const rows = trades.map((x) =>
    [x.mint, x.symbol, x.entryUsd, x.targetUsd, x.exitUsd, x.exitMult.toFixed(3), x.outcome, x.enteredAt, x.exitedAt ?? ""].join(","),
  );
  await fs.writeFile(TRADES, [header, ...rows].join("\n"), "utf8");
}

/**
 * Paper-scalp a single call: buy at current mc, set 2x target / 0.7x stop.
 * We record the intent now; resolvePaperTrades() checks outcomes over time.
 */
export async function scalpCall(c: Callout): Promise<PaperTrade | null> {
  const coin = await fetchCoinNow(c.mint);
  if (!coin) return null;
  const entry = coin.usd_market_cap ?? c.calledMcUsd;
  const trade: PaperTrade = {
    mint: c.mint,
    symbol: c.symbol,
    entryUsd: Math.round(entry),
    targetUsd: Math.round(entry * TARGET_MULT),
    exitUsd: Math.round(entry * STOP_MULT),
    exitMult: 1,
    outcome: "OPEN",
    enteredAt: Date.now() + MS_LATENCY, // account for buy latency
  };
  await saveTrade(trade);
  console.log(`[scalp] OPEN $${c.symbol} @ $${trade.entryUsd} → target $${trade.targetUsd} (+100%) / stop $${trade.exitUsd} (-30%)`);
  return trade;
}

/** Check open trades against current price; close at target or stop. */
export async function resolvePaperTrades(): Promise<{ wins: number; stops: number }> {
  const trades = await loadTrades();
  let wins = 0;
  let stops = 0;
  for (const t of trades) {
    if (t.outcome !== "OPEN") continue;
    const coin = await fetchCoinNow(t.mint);
    if (!coin) continue;
    const mc = coin.usd_market_cap ?? 0;
    const mult = mc / Math.max(1, t.entryUsd);
    if (mult >= TARGET_MULT) {
      t.outcome = "WIN";
      t.exitUsd = Math.round(mc);
      t.exitMult = mult;
      t.exitedAt = Date.now() + MS_LATENCY;
      wins++;
      console.log(`[scalp] WIN  $${t.symbol} +${((mult - 1) * 100).toFixed(0)}%`);
    } else if (mult <= STOP_MULT) {
      t.outcome = "STOP";
      t.exitUsd = Math.round(mc);
      t.exitMult = mult;
      t.exitedAt = Date.now() + MS_LATENCY;
      stops++;
      console.log(`[scalp] STOP $${t.symbol} ${((mult - 1) * 100).toFixed(0)}%`);
    }
    await saveTrade(t);
  }
  return { wins, stops };
}

// run: tsx src/paper-scalp.ts  -> open paper trades for top calls + resolve existing
if (import.meta.url.replace(/\\/g, "/").endsWith("/src/paper-scalp.ts")) {
  (async () => {
    const calls = await recentCallouts(500);
    const top = calls.filter((c) => (c.multiple ?? 0) >= 1.5).slice(0, 3);
    for (const c of top) await scalpCall(c);
    const r = await resolvePaperTrades();
    console.log(`[scalp] resolved: ${r.wins} wins, ${r.stops} stops`);
    process.exit(0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
