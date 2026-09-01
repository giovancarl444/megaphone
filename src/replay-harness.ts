/**
 * replay-harness.ts — score ANY exit rule against recorded trade paths.
 *
 * We record the full mc path (60min, 1 sample/sec) for every paper trade.
 * This harness replays those paths offline and answers: which exit rule
 * would have made money? Rules scored:
 *   - target2x / target3x      : sell at +100% / +200%
 *   - stop30                   : sell at -30%
 *   - trailing20               : sell when mc drops 20% from peak
 *   - timeStop1h / timeStop4h  : sell after N hours regardless
 *   - hisSell                  : sell when the whale sells (copy-exit)
 *   - best                     : theoretical best (sell at path peak)
 *
 * Usage: tsx src/replay-harness.ts [book.json]
 * Output: per-rule PnL table over all trades that have path data.
 */
import { readFileSync } from "node:fs";

const BOOK = process.argv[2] ?? ".copy1/copybook.json";

interface Sample { t: number; mc: number }
interface Trade { mint: string; ourMc: number; targetMc?: number; stopMc?: number; path: Sample[]; wallet?: string }

function loadTrades(): Trade[] {
  try { return JSON.parse(readFileSync(BOOK, "utf8")); }
  catch { console.error("cannot read", BOOK); process.exit(1); }
}

interface RuleResult { rule: string; pnlPct: number; wins: number; losses: number; trades: number; avgHoldMin: number; maxDrawdown: number }

function simulate(trade: Trade, rule: (entry: number, path: Sample[]) => { exitMc: number; holdMs: number } | null): number | null {
  if (!trade.ourMc || !trade.path?.length) return null;
  const r = rule(trade.ourMc, trade.path);
  if (!r) return null;
  return ((r.exitMc - trade.ourMc) / trade.ourMc) * 100;
}

const RULES: Record<string, (entry: number, path: Sample[]) => { exitMc: number; holdMs: number } | null> = {
  "target2x": (e, p) => { const hit = p.find(s => s.mc >= e * 2); return hit ? { exitMc: hit.mc, holdMs: hit.t - p[0].t } : null; },
  "target3x": (e, p) => { const hit = p.find(s => s.mc >= e * 3); return hit ? { exitMc: hit.mc, holdMs: hit.t - p[0].t } : null; },
  "stop30": (e, p) => { const hit = p.find(s => s.mc <= e * 0.7); return hit ? { exitMc: hit.mc, holdMs: hit.t - p[0].t } : null; },
  "trailing20": (e, p) => {
    let peak = e;
    for (const s of p) {
      peak = Math.max(peak, s.mc);
      if (s.mc <= peak * 0.8) return { exitMc: s.mc, holdMs: s.t - p[0].t };
    }
    return null;
  },
  "timeStop1h": (e, p) => { const t1 = p[0].t + 3600_000; const hit = p.find(s => s.t >= t1); return hit ? { exitMc: hit.mc, holdMs: hit.t - p[0].t } : null; },
  "timeStop4h": (e, p) => { const t4 = p[0].t + 4 * 3600_000; const hit = p.find(s => s.t >= t4); return hit ? { exitMc: hit.mc, holdMs: hit.t - p[0].t } : null; },
  "best": (_e, p) => { const peak = p.reduce((m, s) => Math.max(m, s.mc), 0); return { exitMc: peak, holdMs: 0 }; },
};

function main() {
  const trades = loadTrades().filter(t => t.path && t.path.length > 0 && t.ourMc > 0);
  console.log(`=== REPLAY HARNESS — ${trades.length} trades with recorded paths ===`);
  console.log("");
  const results: RuleResult[] = [];
  for (const [name, rule] of Object.entries(RULES)) {
    const pnls: number[] = [];
    let maxDD = 0;
    let holdSum = 0, holdN = 0;
    for (const t of trades) {
      const pnl = simulate(t, rule);
      if (pnl === null) continue;
      pnls.push(pnl);
      const r = rule(t.ourMc, t.path)!;
      holdSum += r.holdMs; holdN++;
      // max drawdown from entry
      for (const s of t.path) maxDD = Math.min(maxDD, ((s.mc - t.ourMc) / t.ourMc) * 100);
    }
    if (!pnls.length) { results.push({ rule: name, pnlPct: 0, wins: 0, losses: 0, trades: 0, avgHoldMin: 0, maxDrawdown: maxDD }); continue; }
    const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const wins = pnls.filter(p => p > 0).length;
    results.push({
      rule: name, pnlPct: Math.round(avg * 10) / 10, wins, losses: pnls.length - wins,
      trades: pnls.length, avgHoldMin: Math.round(holdSum / holdN / 60000), maxDrawdown: Math.round(maxDD * 10) / 10,
    });
  }
  results.sort((a, b) => b.pnlPct - a.pnlPct);
  console.log(`${"rule".padEnd(12)} ${"avgPnL%".padStart(8)} ${"W".padStart(3)} ${"L".padStart(3)} ${"n".padStart(3)} ${"holdMin".padStart(7)} ${"maxDD%".padStart(8)}`);
  for (const r of results) {
    console.log(`${r.rule.padEnd(12)} ${String(r.pnlPct).padStart(8)} ${String(r.wins).padStart(3)} ${String(r.losses).padStart(3)} ${String(r.trades).padStart(3)} ${String(r.avgHoldMin).padStart(7)} ${String(r.maxDrawdown).padStart(8)}`);
  }
  console.log("");
  console.log("note: 'best' = sell at path peak (upper bound). Rules with no exit = trade never triggered, excluded.");
  console.log("maxDD% = worst drawdown from entry across all paths (lower is worse).");
}

main();
