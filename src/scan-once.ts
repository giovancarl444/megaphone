import { scoreCoin } from "./score";
import type { Coin } from "./types";

const BASE = "https://frontend-api-v3.pump.fun/coins";
const LIMIT = 50;

/** One-shot scan of the newest N coins via REST (backfill / reconcile / test). */
export async function scanOnce(limit = LIMIT): Promise<void> {
  const seen = new Set<string>();
  let offset = 0;
  let scanned = 0;
  let passed = 0;
  while (scanned < limit) {
    const url = `${BASE}?offset=${offset}&limit=${Math.min(50, limit - scanned)}&sort=created_timestamp&order=DESC&includeNsfw=false`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      console.error(`scan HTTP ${res.status}`);
      break;
    }
    const batch = (await res.json()) as Coin[];
    if (!batch.length) break;
    for (const c of batch) {
      if (seen.has(c.mint)) continue;
      seen.add(c.mint);
      const r = scoreCoin(c);
      if (r.pass) passed++;
      console.log(
        `${r.pass ? "✅" : "·"} ${c.symbol.padEnd(8)} score=${r.score} age=${r.createdAgoSec}s mc=$${Math.round(r.mcUsd)} ${r.reasons.join(" | ")}`,
      );
    }
    scanned += batch.length;
    offset += batch.length;
    if (batch.length < 50) break;
  }
  console.log(`\nscanned ${scanned}, passed ${passed}`);
}

// run directly: tsx src/scan-once.ts [limit]
if (process.argv[1]?.endsWith("scan-once.ts")) {
  const arg = Number(process.argv[2]);
  scanOnce(Number.isFinite(arg) && arg > 0 ? arg : LIMIT);
}
