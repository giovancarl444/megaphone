import { PUMPFUN_TOKEN } from "./config";

const API = "https://frontend-api-v3.pump.fun";

/**
 * Post a callout (reply/comment) on a coin from OUR pump.fun account.
 * Requires a session JWT — without it we log intent but don't post.
 * This is the "bundle the whale's call into our account" action.
 */
export async function postCallout(mint: string, text: string): Promise<boolean> {
  if (!PUMPFUN_TOKEN) {
    console.log(`[callout] (no token) would post on ${mint}: ${text}`);
    return false;
  }
  try {
    const res = await fetch(`${API}/replies`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PUMPFUN_TOKEN}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ text, mint }),
    });
    console.log(`[callout] POST ${mint} -> ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("[callout] POST failed:", (e as Error).message);
    return false;
  }
}

/**
 * Read a caller's text callouts (needs JWT). Reserved for when we have a
 * session — lets us mirror their CALLS (not just launches) precisely.
 */
export async function fetchCallerCalls(address: string): Promise<any[]> {
  if (!PUMPFUN_TOKEN) return [];
  const res = await fetch(`${API}/callouts?user=${address}`, {
    headers: { Authorization: `Bearer ${PUMPFUN_TOKEN}`, accept: "application/json" },
  });
  if (!res.ok) return [];
  return (await res.json()) as any[];
}
