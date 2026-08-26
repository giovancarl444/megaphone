import { PUMPFUN_TOKEN } from "./config";
import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import path from "node:path";

const API = "https://frontend-api-v3.pump.fun";
const DATA_DIR = () => process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");

/**
 * Post a callout on a coin. pump.fun callouts are community-scoped:
 *   POST /api/v1/communities/{mint}/callouts  { text }
 * Auth: Bearer JWT (minted via login.ts) + Cloudflare-cleared browser session.
 *
 * Posting goes THROUGH a real headless browser (Puppeteer) because pump.fun
 * sits behind Cloudflare, which blocks server-side fetch on write endpoints.
 * The browser solves CF and the request passes.
 *
 * Without a CF-cleared session + valid JWT, we dry-run (log intent only).
 */
export async function postCallout(mint: string, text: string): Promise<boolean> {
  if (!PUMPFUN_TOKEN) {
    console.log(`[callout] (dry-run, no token) would post on ${mint}: ${text}`);
    return false;
  }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    // load a pump.fun page first so Cloudflare clears + cookies establish
    await page.goto("https://pump.fun", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
    const token = PUMPFUN_TOKEN;
    const result = await page.evaluate(
      async (api: string, mint: string, text: string, token: string) => {
        const res = await fetch(`${api}/api/v1/communities/${mint}/callouts`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: "https://pump.fun" },
          body: JSON.stringify({ text }),
        });
        const body = await res.text();
        return { status: res.status, body: body.slice(0, 200) };
      },
      API,
      mint,
      text,
      token,
    );
    console.log(`[callout] POST ${mint} -> ${result.status} ${result.body}`);
    return result.status >= 200 && result.status < 300;
  } catch (e) {
    console.error("[callout] POST failed:", (e as Error).message);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

/** Read a user's callouts (needs JWT). Reserved for whale-mirror of CALLS. */
export async function fetchUserCallouts(userId: string): Promise<any[]> {
  if (!PUMPFUN_TOKEN) return [];
  try {
    const res = await fetch(`${API}/api/v1/users/${userId}/callouts`, {
      headers: { Authorization: `Bearer ${PUMPFUN_TOKEN}`, Accept: "application/json", Origin: "https://pump.fun" },
    });
    if (!res.ok) return [];
    return (await res.json()) as any[];
  } catch {
    return [];
  }
}
