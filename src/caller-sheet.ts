import { promises as fs } from "node:fs";
import path from "node:path";
import { recentCallouts } from "./leaderboard";

const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const OUT = path.join(DATA_DIR, "callers.csv");

/**
 * Export every callout to a CSV — the caller-tracking spreadsheet.
 * One row per call: caller, symbol, mint, multiple, calledMc, thesis, source.
 * Lets us line up each caller's calls and measure their real hit-rate.
 *
 * Run: tsx src/caller-sheet.ts
 */
export async function writeCallerSheet(): Promise<string> {
  const calls = await recentCallouts(5000);
  const rows = calls.map((c) => {
    const thesis = (c.reasons.find((r) => r.startsWith("thesis:")) ?? "").replace("thesis: ", "").replace(/"/g, "'");
    return [
      c.sourceHandle ?? "",
      c.symbol,
      c.mint,
      (c.multiple ?? "").toString(),
      c.calledMcUsd,
      c.source,
      thesis,
      c.broadcasted ? "Y" : "N",
    ].join(",");
  });
  const header = "caller,symbol,mint,multiple,calledMcUsd,source,thesis,broadcasted";
  const csv = [header, ...rows].join("\n");
  await fs.writeFile(OUT, csv, "utf8");

  // per-caller summary
  const byCaller = new Map<string, { calls: number; wins: number; best: number }>();
  for (const c of calls) {
    const h = c.sourceHandle ?? "unknown";
    const cur = byCaller.get(h) ?? { calls: 0, wins: 0, best: 0 };
    cur.calls++;
    if ((c.multiple ?? 0) >= 1.5) cur.wins++;
    cur.best = Math.max(cur.best, c.multiple ?? 0);
    byCaller.set(h, cur);
  }
  const summary = [...byCaller.entries()]
    .sort((a, b) => b[1].best - a[1].best)
    .map(([h, s]) => `  ${h}: ${s.calls} calls, ${s.wins} wins, best ${s.best.toFixed(1)}x`)
    .join("\n");

  console.log(`[sheet] wrote ${rows.length} calls -> ${OUT}`);
  console.log(`[sheet] per-caller:\n${summary}`);
  return OUT;
}

if (import.meta.url.replace(/\\/g, "/").endsWith("/src/caller-sheet.ts")) {
  writeCallerSheet().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
