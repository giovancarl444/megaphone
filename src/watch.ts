import { fileURLToPath } from "node:url";
import { CONFIG, FOUNDER_CHAT } from "./config";
import { scoreCoin } from "./score";
import type { Coin } from "./types";

const BASE = "https://frontend-api-v3.pump.fun/coins";
const POLL_MS = 4_000; // 4s — matches the scanner; REST is unthrottled, no key
const seen = new Set<string>();
// velocity tracking: mint -> { realSol, t } so we can measure buy momentum
const velocity = new Map<string, { realSol: number; t: number }>();

/** Push alert to founder chat. No agent loop needed. */
async function alert(text: string) {
  try {
    const { execSync } = await import("node:child_process");
    execSync(`hermes send --to ${FOUNDER_CHAT} ${JSON.stringify(text)}`, {
      stdio: "ignore",
    });
    console.log("[alert] sent ->", text.split("\n")[0]);
  } catch (e) {
    console.warn("[alert] failed:", (e as Error).message);
  }
}

async function pollOnce(): Promise<void> {
  try {
    const res = await fetch(
      `${BASE}?offset=0&limit=30&sort=created_timestamp&order=DESC&includeNsfw=false`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) {
      console.error(`poll HTTP ${res.status}`);
      return;
    }
    const batch = (await res.json()) as Coin[];
    for (const c of batch) {
      if (seen.has(c.mint)) continue;
      seen.add(c.mint);
      // compute buy momentum (SOL/min) from last poll if we saw it before
      const realSolNow = (c.real_sol_reserves || 0) / 1e9;
      const prev = velocity.get(c.mint);
      let velSolPerMin = 0;
      if (prev) {
        const dtMin = Math.max(0.05, (Date.now() - prev.t) / 60000);
        velSolPerMin = (realSolNow - prev.realSol) / dtMin;
      }
      velocity.set(c.mint, { realSol: realSolNow, t: Date.now() });
      const r = scoreCoin(c, Date.now(), velSolPerMin);
      console.log(
        `${r.pass ? "✅" : "·"} ${c.symbol.padEnd(9)} s=${r.score} ${r.reasons.join(" | ")}`,
      );
      if (!r.pass) continue;

      const text =
        `$${c.symbol} — early filter call\n` +
        `score ${r.score}/100 · $${Math.round(r.mcUsd)} mc · ${r.createdAgoSec}s old\n` +
        `${r.reasons.filter((x) => !x.startsWith("FAIL")).join(" · ")}`;
      // 0) log to shared callouts ledger (the proof engine reads this)
      try {
        const { logCallout } = await import("./leaderboard");
        await logCallout({
          mint: c.mint,
          symbol: c.symbol,
          name: c.name,
          source: "firehose",
          calledMcUsd: Math.round(r.mcUsd),
          calledRealSol: r.realSol,
          calledAgeSec: r.createdAgoSec,
          score: r.score,
          reasons: r.reasons,
          socials: r.socials,
        });
      } catch { /* non-fatal */ }
      // 1) alert founder chat (single-line to survive shell quoting)
      const oneline = `📣 CALL $${c.symbol} | ${r.score}/100 | $${Math.round(r.mcUsd)} mc | ${r.createdAgoSec}s | ${r.reasons.filter((x) => !x.startsWith("FAIL")).join(" ")} | mint:${c.mint}`;
      await alert(oneline);
      // 2) bundle into OUR pump.fun account (posts if PUMPFUN_TOKEN set)
      const { postCallout } = await import("./callout");
      await postCallout(c.mint, text);
    }
  } catch (e) {
    console.error("poll error:", (e as Error).message);
  }
}

export function startWatch(restMode = true): void {
  if (restMode) {
    console.log(
      `[watch] REST-poll mode (no key) every ${POLL_MS}ms — alert ≥${CONFIG.alertThreshold}`,
    );
    // prime the seen-set so we don't alert the entire current feed on first run
    pollOnce().then(() => {
      console.log("[watch] primed, live from here");
      setInterval(pollOnce, POLL_MS);
    });
  }
}

// run directly: tsx src/watch.ts
const isMain = fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith("/src/watch.ts");
if (isMain) {
  console.log(`MEGAPHONE watcher — maxAge ${CONFIG.maxAgeSec}s, alert ≥${CONFIG.alertThreshold}`);
  startWatch(true);
}
