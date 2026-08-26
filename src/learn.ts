import { promises as fs } from "node:fs";
import path from "node:path";
import { recentCallouts, getTrackRecord } from "./leaderboard";

const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");

/**
 * Outcome learning. As calls resolve, we learn which call-time features
 * separate winners (multiple >= 1.5) from losers. This is the feedback loop
 * that turns the heuristic scorer into a tuned one — the foundation of a
 * real win-rate, which is what drives pump.fun followers.
 *
 * Run: tsx src/learn.ts  -> prints a feature-importance report.
 * (Auto-tuning the scorer weights from this is the next step once we have
 * enough resolved winners — pump.fun base rate is ~2%, so we need volume.)
 */
export async function learnReport(): Promise<string> {
  const calls = await recentCallouts(5000);
  const resolved = calls.filter((c) => c.multiple !== undefined && c.multiple !== null);
  const wins = resolved.filter((c) => (c.multiple ?? 0) >= 1.5);
  const losses = resolved.filter((c) => (c.multiple ?? 0) < 1.0);

  if (resolved.length < 20) {
    return `Not enough resolved calls yet (${resolved.length}). Need 20+ to learn. Keep running.`;
  }

  const avg = (arr: typeof resolved, key: "calledRealSol" | "calledAgeSec" | "score") =>
    arr.length ? arr.reduce((a, c) => a + (c[key] ?? 0), 0) / arr.length : 0;

  const lines = [
    `LEARNING REPORT (${resolved.length} resolved, ${wins.length} wins, ${losses.length} losses)`,
    `win-rate: ${((wins.length / resolved.length) * 100).toFixed(1)}%`,
    "",
    `Feature        | winners avg | losers avg | delta`,
    `calledRealSol  | ${avg(wins, "calledRealSol").toFixed(2)}       | ${avg(losses, "calledRealSol").toFixed(2)}      | ${(avg(wins, "calledRealSol") - avg(losses, "calledRealSol")).toFixed(2)}`,
    `calledAgeSec   | ${avg(wins, "calledAgeSec").toFixed(0)}        | ${avg(losses, "calledAgeSec").toFixed(0)}       | ${(avg(wins, "calledAgeSec") - avg(losses, "calledAgeSec")).toFixed(0)}`,
    `score          | ${avg(wins, "score").toFixed(0)}          | ${avg(losses, "score").toFixed(0)}         | ${(avg(wins, "score") - avg(losses, "score")).toFixed(0)}`,
    "",
    `Insight: features with the LARGEST positive delta separate winners from losers.`,
    `Current base rate on pump.fun is ~2% — beating it requires the scorer to weight`,
    `the winning delta features heavily.`,
  ];
  return lines.join("\n");
}

if (import.meta.url.replace(/\\/g, "/").endsWith("/src/learn.ts")) {
  learnReport().then((r) => console.log(r));
}
