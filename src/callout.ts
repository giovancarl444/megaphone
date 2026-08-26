import { PUMPFUN_TOKEN } from "./config";

const API = "https://frontend-api-v3.pump.fun";

// Cloudflare bypass: pump.fun sits behind CF and rejects requests without a
// valid `cf_clearance` cookie (from a real browser that solved the challenge).
// Paste your browser's cookies once via env (or .megaphone/cookies.json) and
// posting works. Cookies last hours/days.
function loadCookies(): string {
  if (process.env.PUMPFUN_COOKIES) return process.env.PUMPFUN_COOKIES;
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
    return fs.readFileSync(path.join(DATA_DIR, "cookies.json"), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Post a callout (reply/comment) on a coin from OUR pump.fun account.
 * Requires session JWT + CF cookies. Without them we log intent but don't post.
 * This is the "bundle the whale's call into our account" action.
 */
export async function postCallout(mint: string, text: string): Promise<boolean> {
  const cookie = loadCookies();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "application/json",
    Origin: "https://pump.fun",
    Referer: `https://pump.fun/coin/${mint}`,
  };
  if (PUMPFUN_TOKEN) headers["Authorization"] = `Bearer ${PUMPFUN_TOKEN}`;
  if (cookie) headers["Cookie"] = cookie;

  if (!PUMPFUN_TOKEN || !cookie) {
    console.log(`[callout] (dry-run, no auth/cookies) would post on ${mint}: ${text}`);
    return false;
  }
  try {
    const res = await fetch(`${API}/replies`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, mint }),
    });
    const body = await res.text().catch(() => "");
    console.log(`[callout] POST ${mint} -> ${res.status} ${body.slice(0, 120)}`);
    return res.ok;
  } catch (e) {
    console.error("[callout] POST failed:", (e as Error).message);
    return false;
  }
}

/**
 * Read a caller's text callouts (needs JWT + cookies). Reserved for when we
 * have a session — lets us mirror their CALLS (not just launches) precisely.
 */
export async function fetchCallerCalls(address: string): Promise<any[]> {
  const cookie = loadCookies();
  const headers: Record<string, string> = {
    accept: "application/json",
    Origin: "https://pump.fun",
  };
  if (PUMPFUN_TOKEN) headers["Authorization"] = `Bearer ${PUMPFUN_TOKEN}`;
  if (cookie) headers["Cookie"] = cookie;
  if (!PUMPFUN_TOKEN) return [];
  const res = await fetch(`${API}/callouts?user=${address}`, { headers });
  if (!res.ok) return [];
  return (await res.json()) as any[];
}
