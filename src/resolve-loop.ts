import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import {
  resolveCallout,
  updateCallout,
  getTrackRecord,
  recentCallouts,
  type Callout,
} from "./leaderboard";
import { fetchCoinNow } from "./whales";
import { FOUNDER_CHAT, PROOF_CALL_REPLY_TOKEN } from "./config";
import { postCallout } from "./callout";

const RESOLVE_WINDOW_MS = 45 * 60 * 1000; // only resolve calls older than 45m
const PROOF_MIN_MULT = 1.5; // post proof only for >=1.5x wins

interface LoopResult {
  resolved: number;
  proofs: number;
  skipped: number;
}

/**
 * One sweep: resolve any open calls old enough to have moved, then broadcast
 * proof for wins not yet posted. This is the engine that turns calls into the
 * track record that drives followers.
 */
export async function resolveLoop(): Promise<LoopResult> {
  const calls = await recentCallouts(500);
  let resolved = 0;
  let proofs = 0;
  let skipped = 0;

  for (const c of calls) {
    if (c.resolvedAt) {
      // already resolved — maybe still need to post proof
      if (
        !c.proofPosted &&
        c.multiple !== undefined &&
        c.multiple >= PROOF_MIN_MULT
      ) {
        await postProof(c);
        await updateCallout(c.mint, { proofPosted: true });
        proofs++;
      }
      continue;
    }

    const ageMs = Date.now() - c.calledAt;
    if (ageMs < RESOLVE_WINDOW_MS) {
      skipped++; // too fresh
      continue;
    }

    const coin = await fetchCoinNow(c.mint);
    const resolvedMc = coin?.usd_market_cap ?? 0;
    const graduated = coin?.complete ?? false;
    await resolveCallout(c.mint, { resolvedMcUsd: resolvedMc, graduated });

    const mult = resolvedMc / Math.max(1, c.calledMcUsd);
    if (mult >= PROOF_MIN_MULT) {
      await postProof({ ...c, resolvedMcUsd: resolvedMc, multiple: mult, graduated });
      await updateCallout(c.mint, { proofPosted: true });
      proofs++;
    }
    resolved++;
  }

  const tr = await getTrackRecord();
  console.log(
    `[resolve-loop] resolved=${resolved} proofs=${proofs} skipped=${skipped} | ` +
      `track: ${tr.resolved}/${tr.total} · win-rate ${(tr.winRate * 100).toFixed(0)}% · avg ${tr.avgMultiple.toFixed(2)}x · best ${tr.bestMultiple.toFixed(2)}x`,
  );

  // periodic learning insight (feature deltas separate winners from losers)
  if (tr.resolved >= 20) {
    const { learnReport } = await import("./learn");
    console.log("[learn]\n" + (await learnReport()));
  }
  return { resolved, proofs, skipped };
}

async function postProof(c: Callout): Promise<void> {
  const mult = c.multiple ?? (c.resolvedMcUsd ? c.resolvedMcUsd / Math.max(1, c.calledMcUsd) : 0);
  const text =
    `📈 CALL PROOF $${c.symbol}\n` +
    `called $${Math.round(c.calledMcUsd)} → now $${Math.round(c.resolvedMcUsd ?? 0)} (${mult.toFixed(2)}x${c.graduated ? " · GRADUATED" : ""})\n` +
    `mint:${c.mint}`;
  try {
    execSync(`hermes send --to ${FOUNDER_CHAT} "${text.replace(/"/g, "'")}"`, {
      stdio: "ignore",
    });
  } catch {
    /* non-fatal */
  }
  if (PROOF_CALL_REPLY_TOKEN) {
    await postCallout(c.mint, text);
  }
}

// run: tsx src/resolve-loop.ts
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  resolveLoop()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[resolve-loop] fatal", e);
      process.exit(1);
    });
}
