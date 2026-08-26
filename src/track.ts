import { scoreCoin } from "./score";
import type { Coin } from "./types";

const BASE = "https://frontend-api-v3.pump.fun/coins";

/**
 * Resolve the outcome of a called coin — this is what builds a
 * leaderboard-grade track record (the thing that compounds followers).
 * Compares market cap at call time vs now and reports multiple-x.
 */
export async function resolve(mint: string, calledMcUsd: number): Promise<void> {
  const res = await fetch(`${BASE}/${mint}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`resolve HTTP ${res.status}`);
    return;
  }
  const c = (await res.json()) as Coin;
  const nowMc = c.usd_market_cap || c.market_cap_usd || 0;
  const mult = calledMcUsd > 0 ? nowMc / calledMcUsd : 0;
  const outcome = mult >= 2 ? "🚀 WIN" : mult >= 1 ? "✅ ok" : "❌ L";
  console.log(
    `${outcome} $${c.symbol} called $${Math.round(calledMcUsd)} → $${Math.round(nowMc)} (${mult.toFixed(2)}x) complete=${c.complete}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mint = process.argv[2];
  const called = Number(process.argv[3] ?? 0);
  if (!mint) {
    console.error("usage: tsx src/track.ts <mint> [calledMcUsd]");
    process.exit(1);
  }
  resolve(mint, called);
}
