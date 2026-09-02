/**
 * vybe-insiders.ts — Phase 2 (FIND insiders) via Vybe Top Traders API.
 *
 * Pulls top Solana traders ranked by PnL / win rate / volume, then filters to
 * the ones that matter for OUR game (pump.fun / memecoin traders) and writes a
 * ranked insider-candidate list to .megaphone/insiders.json.
 *
 * Requires VYBE_API_KEY env var (free plan: https://vybe.fyi/api-pricing).
 *
 * Usage:
 *   VYBE_API_KEY=xxx tsx src/vybe-insiders.ts            -> 7d top traders
 *   VYBE_API_KEY=xxx tsx src/vybe-insiders.ts 30d        -> 30d window
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const KEY = process.env.VYBE_API_KEY;
const BASE = "https://api.vybenetwork.xyz/v4/wallets/top-traders";

interface Insider {
  address: string;
  realizedPnlUsd: number;
  winRate: number | null;
  totalVolumeUsd: number | null;
  tradeCount: number | null;
  bestToken: string | null;
  label: string | null;
  score: number; // composite copyability score
}

export async function fetchTopTraders(resolution: "1d" | "7d" | "30d" = "7d", limit = 200): Promise<any[]> {
  if (!KEY) throw new Error("VYBE_API_KEY not set — get free key at https://vybe.fyi/api-pricing");
  const url = `${BASE}?resolution=${resolution}&limit=${limit}`;
  const res = await fetch(url, { headers: { "x-api-key": KEY, "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Vybe HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const j: any = await res.json();
  return j?.data ?? [];
}

/** Composite score: what makes a wallet COPYABLE — proven, active, memecoin-ish. */
function scoreInsider(t: any): number {
  const m = t?.metrics ?? {};
  const pnl = Number(m.realizedPnlUsd ?? 0);
  const wr = Number(m.winRate ?? 0);
  const vol = Number(m.totalVolumeUsd ?? 0);
  const trades = Number(m.tradeCount ?? 0);
  let s = 0;
  // profitability: up to 40
  s += Math.max(0, Math.min(40, Math.log10(Math.max(1, pnl)) * 6));
  // win rate: up to 25
  s += Math.max(0, Math.min(25, wr * 100 * 0.25));
  // activity: up to 20 (need samples — 0.5 trades/day over 7d = decent)
  s += Math.max(0, Math.min(20, Math.log10(Math.max(1, trades)) * 6));
  // volume scale: up to 15
  s += Math.max(0, Math.min(15, Math.log10(Math.max(1, vol)) * 2.5));
  return Math.round(s);
}

async function main() {
  const resArg = (process.argv[2] || "7d") as "1d" | "7d" | "30d";
  const traders = await fetchTopTraders(resArg);
  const insiders: Insider[] = traders.map((t) => {
    const m = t?.metrics ?? {};
    const best = m?.bestPerformingToken;
    return {
      address: t?.accountAddress ?? "",
      realizedPnlUsd: Math.round(Number(m.realizedPnlUsd ?? 0)),
      winRate: m.winRate != null ? Math.round(Number(m.winRate) * 1000) / 10 : null,
      totalVolumeUsd: m.totalVolumeUsd != null ? Math.round(Number(m.totalVolumeUsd)) : null,
      tradeCount: m.tradeCount != null ? Number(m.tradeCount) : null,
      bestToken: best?.symbol || best?.tokenAddress || null,
      label: (t?.labels?.[0]?.label || null) as string | null,
      score: scoreInsider(t),
    };
  }).filter((i) => i.address && i.score > 0).sort((a, b) => b.score - a.score);

  // Top 50 by copyability score
  const top = insiders.slice(0, 50);
  const outFile = path.join(process.cwd(), ".megaphone", "insiders.json");
  writeFileSync(outFile, JSON.stringify({ resolution: resArg, fetchedAt: Date.now(), count: top.length, insiders: top }, null, 2));
  console.log(`=== INSIDERS (${resArg}) — top 50 by copyability score ===`);
  for (const i of top.slice(0, 15)) {
    console.log(`  ${i.score.toString().padStart(3)} | ${i.address.slice(0, 10)}… | pnl $${i.realizedPnlUsd.toLocaleString()} | wr ${i.winRate ?? "?"}% | ${i.bestToken ?? ""}${i.label ? ` [${i.label}]` : ""}`);
  }
  console.log(`\nwritten: ${outFile} (${top.length} insiders)`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
