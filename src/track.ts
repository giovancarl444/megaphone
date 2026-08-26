import { resolveCallout, getTrackRecord, logCallout } from "./leaderboard";
import type { Coin } from "./types";

const BASE = "https://frontend-api-v3.pump.fun/coins";

/**
 * Resolve the outcome of a called coin — this is what builds a
 * leaderboard-grade track record. Run later (minutes/hours after the call)
 * to record the multiple. Also prints the aggregate win-rate.
 */
export async function resolve(
  mint: string,
  calledMcUsd?: number,
): Promise<void> {
  // fetch current state
  let c: Coin | null = null;
  try {
    const res = await fetch(`${BASE}/${mint}`, { headers: { accept: "application/json" } });
    if (res.ok) c = (await res.json()) as Coin;
  } catch {
    /* ignore */
  }
  const resolvedMcUsd = c?.usd_market_cap ?? 0;
  const graduated = c?.complete ?? false;

  const entry = await resolveCallout(mint, { resolvedMcUsd, graduated });
  if (!entry) {
    console.log(`no callout logged for ${mint} — logging fresh at mc $${Math.round(resolvedMcUsd)}`);
    if (calledMcUsd) {
      await logCallout({
        mint,
        symbol: c?.symbol ?? "?",
        source: "firehose",
        calledMcUsd,
        score: 0,
        reasons: ["manual"],
        socials: [],
      });
      await resolveCallout(mint, { resolvedMcUsd, graduated });
    }
  } else {
    const mult = entry.multiple ?? 0;
    console.log(
      `resolved ${entry.symbol}: called $${Math.round(entry.calledMcUsd)} → now $${Math.round(resolvedMcUsd)} (${mult.toFixed(2)}x${graduated ? ", GRADUATED" : ""})`,
    );
  }

  const tr = await getTrackRecord();
  console.log(
    `\ntrack record: ${tr.resolved}/${tr.total} resolved · wins ${tr.wins} · losses ${tr.losses} · avg ${tr.avgMultiple.toFixed(2)}x · best ${tr.bestMultiple.toFixed(2)}x · win-rate ${(tr.winRate * 100).toFixed(0)}%`,
  );
}

// run: tsx src/track.ts <mint> [calledMcUsd]
if (process.argv[1]?.endsWith("track.ts")) {
  const mint = process.argv[2];
  const mc = Number(process.argv[3]);
  if (!mint) {
    console.error("usage: tsx src/track.ts <mint> [calledMcUsd]");
    process.exit(1);
  }
  resolve(mint, Number.isFinite(mc) && mc > 0 ? mc : undefined);
}
