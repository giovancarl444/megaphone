import { WHALES } from "./config";
import type { Coin } from "./types";

const BASE = "https://frontend-api-v3.pump.fun/coins";

/**
 * Fetch launches by a whale wallet since `sinceMs`.
 * No auth needed — the creatorAddress filter is publicly readable.
 * A launcher's new coin IS their call (they're the dev, they believe in it).
 */
export async function fetchWhaleLaunches(
  address: string,
  sinceMs: number,
): Promise<Coin[]> {
  const out: Coin[] = [];
  let offset = 0;
  for (let page = 0; page < 5; page++) {
    const res = await fetch(
      `${BASE}?creatorAddress=${address}&offset=${offset}&limit=50&includeNsfw=true`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) break;
    const batch = (await res.json()) as Coin[];
    if (!batch.length) break;
    for (const c of batch) {
      if (c.created_timestamp >= sinceMs) out.push(c);
    }
    offset += batch.length;
    if (batch.length < 50) break;
  }
  return out;
}

/** Fetch current state of a single coin by mint (used by the resolve loop). */
export async function fetchCoinNow(mint: string): Promise<Coin | null> {
  try {
    const res = await fetch(`${BASE}/${mint}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as Coin;
  } catch {
    return null;
  }
}
