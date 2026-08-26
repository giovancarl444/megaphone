import { fileURLToPath } from "node:url";
import {
  CONFIG,
  FOUNDER_CHAT,
  PUMPFUN_TOKEN,
  WHALES,
  WHALE_LOOKBACK_MS,
  WHALE_POLL_MS,
} from "./config";
import { scoreCoin } from "./score";
import { fetchWhaleLaunches } from "./whales";
import { postCallout } from "./callout";
import type { Coin } from "./types";

const seen = new Set<string>(); // mints we've already processed (this run)

function callText(c: Coin, score: number, reasons: string[]): string {
  const why = reasons.filter((r) => !r.startsWith("FAIL")).join(", ");
  return (
    `$${c.symbol} — called by @${WHALES.find((w) => w.address === c.creator)?.handle ?? "whale"}\n` +
    `filter score ${score}/100 · $${Math.round(c.usd_market_cap || 0)} mc\n` +
    `why: ${why}`
  );
}

async function processWhale(address: string, handle: string) {
  const since = Date.now() - WHALE_LOOKBACK_MS;
  let launches: Coin[];
  try {
    launches = await fetchWhaleLaunches(address, since);
  } catch (e) {
    console.error(`[mirror] ${handle} fetch failed:`, (e as Error).message);
    return;
  }
  for (const c of launches) {
    if (seen.has(c.mint)) continue;
    seen.add(c.mint);
    if (c.creator !== address) continue; // only coins THEY launched
    const r = scoreCoin(c);
    const tag = `${handle}/${c.symbol}`;
    console.log(`${r.pass ? "🔁" : "·"} ${tag.padEnd(20)} s=${r.score} ${r.reasons.join(" | ")}`);
    if (!r.pass) continue;

    const text = callText(c, r.score, r.reasons);
    // 1) alert founder chat
    try {
      const { execSync } = await import("node:child_process");
      execSync(`hermes send --to ${FOUNDER_CHAT} 🐋 MIRROR ${text}`, { stdio: "ignore" });
    } catch {
      /* non-fatal */
    }
    // 2) bundle into OUR account (posts if we have a pump.fun session)
    await postCallout(c.mint, text);
  }
}

export function startMirror(): void {
  console.log(
    `[mirror] watching ${WHALES.length} whales every ${WHALE_POLL_MS / 1000}s` +
      (PUMPFUN_TOKEN ? " (LIVE posting)" : " (dry-run: no PUMPFUN_TOKEN)"),
  );
  const tick = () => {
    for (const w of WHALES) void processWhale(w.address, w.handle);
  };
  tick();
  setInterval(tick, WHALE_POLL_MS);
}

// run directly: tsx src/mirror.ts
const isMain = fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith("/src/mirror.ts");
if (isMain) {
  startMirror();
}
