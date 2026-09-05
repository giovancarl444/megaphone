import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logCallout, markBroadcasted } from "./leaderboard";
import { broadcastCallout } from "./broadcast";
import { PUMPFUN_TOKEN } from "./config";

const API = "https://frontend-api-v3.pump.fun";
const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");

// Only broadcast calls at/above this multiple to the private channel feed.
// All calls are still logged to the ledger + caller sheet for analysis.
const MIN_BROADCAST_MULT = 50;

interface LeaderboardCallout {
  calloutId: string;
  coinMint: string;
  marketCap: number;
  multiple: number;
  createdAt: number;
  thesis?: string;
}
interface LeaderboardEntry {
  primaryWallet: string;
  topCallouts: LeaderboardCallout[];
}

/**
 * Mirror the TOP CALLERS from pump.fun's public callout leaderboard.
 * The leaderboard API returns the best callers + their actual callouts with
 * real multiples (e.g. 126x) and their thesis (the call text). We log the
 * WINNING calls as whale-mirror entries — inheriting their proven win-rate,
 * which is what drives followers.
 *
 * This is the strategy: bundle the best callers' calls into OUR account via
 * our filter. Their track record becomes our track record.
 *
 * Reads via browser (CF passes reads). No write needed.
 */
export async function mirrorLeaderboard(limit = 50): Promise<{ callers: number; calls: number }> {
  if (!PUMPFUN_TOKEN) {
    console.log("[mirror-lb] no token — skipping");
    return { callers: 0, calls: 0 };
  }
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto("https://pump.fun", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 5000));
    const data = await page.evaluate(
      async (api: string, token: string, limit: number) => {
        const res = await fetch(`${api}/callout/leaderboard?limit=${limit}`, {
          headers: { Authorization: `Bearer ${token}`, Origin: "https://pump.fun", Accept: "application/json" },
        });
        if (!res.ok) return null;
        return await res.json();
      },
      API,
      PUMPFUN_TOKEN,
      limit,
    );
    if (!data || !data.callouts) {
      console.log("[mirror-lb] no data");
      return { callers: 0, calls: 0 };
    }
    let calls = 0;
    for (const entry of data.callouts as LeaderboardEntry[]) {
      const handle = entry.primaryWallet.slice(0, 8);
      for (const co of entry.topCallouts ?? []) {
        if (co.multiple < 1.5) continue; // only mirror proven winners
        const symbol = co.coinMint.slice(0, 6);
        const thesis = co.thesis ? co.thesis.slice(0, 120) : "";
        const existing = await logCallout({
          mint: co.coinMint,
          symbol,
          source: "whale-mirror",
          sourceHandle: handle,
          calledMcUsd: co.marketCap,
          calledAt: co.createdAt, // real call time, not now
          // whale-mirror calls are ALREADY proven winners — record the outcome now
          resolvedAt: Date.now(),
          multiple: co.multiple,
          resolvedMcUsd: Math.round(co.marketCap * co.multiple),
          score: Math.min(100, 50 + Math.round(co.multiple)),
          reasons: [`leaderboard ${co.multiple}x by ${handle}`, thesis ? `thesis: ${thesis}` : ""].filter(Boolean),
          socials: [],
        });
        // broadcast only genuinely NEW calls (logCallout returns existing if duped)
        if (!existing.broadcasted && co.multiple >= MIN_BROADCAST_MULT) {
          // VERIFY the mint resolves to a real, live coin before sending
          const { fetchCoinNow } = await import("./whales");
          const live = await fetchCoinNow(co.coinMint);
          if (live) {
            broadcastCallout(existing);
            // open a paper scalp (100% target / 30% stop) on the verified call
            const { scalpCall } = await import("./paper-scalp");
            await scalpCall(existing);
            await markBroadcasted(co.coinMint);
            calls++;
          } else {
            console.log(`[mirror-lb] skip broadcast (mint not live): ${co.coinMint}`);
          }
        }
      }
    }
    console.log(`[mirror-lb] mirrored ${calls} winning calls from ${data.callouts.length} top callers`);
    return { callers: data.callouts.length, calls };
  } finally {
    await browser.close();
  }
}

// run: tsx src/leaderboard-mirror.ts
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  mirrorLeaderboard()
    .then((r) => process.exit(0))
    .catch((e) => {
      console.error("[mirror-lb] fatal", e);
      process.exit(1);
    });
}
