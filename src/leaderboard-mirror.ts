import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { logCallout } from "./leaderboard";
import { PUMPFUN_TOKEN } from "./config";

const API = "https://frontend-api-v3.pump.fun";
const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");

interface LeaderboardEntry {
  primaryWallet: string;
  topCallouts: { coinMint: string; symbol?: string; multiple: number; marketCap: number }[];
}

/**
 * Mirror the TOP CALLERS from pump.fun's public callout leaderboard.
 * The leaderboard API returns the best callers + their actual callouts with
 * real multiples (e.g. 126x). We log the WINNING calls as whale-mirror
 * entries — inheriting their proven win-rate, which is what drives followers.
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
        const symbol = co.symbol ?? co.coinMint.slice(0, 6);
        await logCallout({
          mint: co.coinMint,
          symbol,
          source: "whale-mirror",
          sourceHandle: handle,
          calledMcUsd: co.marketCap,
          score: Math.min(100, 50 + Math.round(co.multiple)),
          reasons: [`leaderboard call ${co.multiple}x by ${handle}`],
          socials: [],
        });
        calls++;
      }
    }
    console.log(`[mirror-lb] mirrored ${calls} winning calls from ${data.callouts.length} top callers`);
    return { callers: data.callouts.length, calls };
  } finally {
    await browser.close();
  }
}

// run: tsx src/leaderboard-mirror.ts
if (import.meta.url.replace(/\\/g, "/").endsWith("/src/leaderboard-mirror.ts")) {
  mirrorLeaderboard()
    .then((r) => process.exit(0))
    .catch((e) => {
      console.error("[mirror-lb] fatal", e);
      process.exit(1);
    });
}
