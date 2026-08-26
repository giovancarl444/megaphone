import { fileURLToPath } from "node:url";
import { CONFIG, FOUNDER_CHAT } from "./config";
import { scoreCoin } from "./score";
import type { Coin } from "./types";

const BASE = "https://frontend-api-v3.pump.fun/coins";
const POLL_MS = 4_000; // 4s — matches the scanner; REST is unthrottled, no key
const seen = new Set<string>();

function fmt(r: ReturnType<typeof scoreCoin>): string {
  const socials = r.socials.length ? r.socials.join("/") : "none";
  return (
    `📣 CALL — $${r.symbol}\n` +
    `score ${r.score}/100 · $${Math.round(r.mcUsd)} mc · ${r.createdAgoSec}s old\n` +
    `${r.reasons.filter((x) => !x.startsWith("FAIL")).join(" · ")}\n` +
    `mint: ${r.mint}`
  );
}

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
      const r = scoreCoin(c);
      console.log(
        `${r.pass ? "✅" : "·"} ${c.symbol.padEnd(9)} s=${r.score} ${r.reasons.join(" | ")}`,
      );
      if (r.pass) await alert(fmt(r));
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
