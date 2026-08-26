import { CONFIG } from "./config";
import type { Coin, ScoreResult } from "./types";

/** Heuristic "is this coin worth a callout" scorer. Returns 0-100 + reasons. */
export function scoreCoin(coin: Coin, nowMs = Date.now()): ScoreResult {
  const reasons: string[] = [];
  let score = 0;
  const fail: string[] = [];

  const ageSec = Math.max(0, Math.round((nowMs - coin.created_timestamp) / 1000));
  const mcUsd = coin.usd_market_cap || coin.market_cap_usd || 0;

  // --- hard gates (instant fail) ---
  if (CONFIG.skipBanned && coin.is_banned) fail.push("banned");
  if (CONFIG.skipNsfw && coin.nsfw) fail.push("nsfw");
  if (CONFIG.skipComplete && coin.complete) fail.push("graduated");
  if (ageSec > CONFIG.maxAgeSec) fail.push(`age ${ageSec}s > ${CONFIG.maxAgeSec}`);
  const realSol = (coin.real_sol_reserves || 0) / 1e9;
  if (realSol < CONFIG.minRealSol) fail.push(`realSol ${realSol.toFixed(2)} < ${CONFIG.minRealSol}`);

  // --- soft signals (add score) ---
  // 0) socials present (legitimacy) — computed first so later blocks can use it
  const socials: string[] = [];
  if (coin.twitter) socials.push("x");
  if (coin.telegram) socials.push("tg");
  if (coin.website) socials.push("web");
  if (CONFIG.requireX && !socials.includes("x")) {
    fail.push("no-x");
  }

  // 1) early enough to be a real "call"
  if (ageSec <= 120) score += 22;
  else if (ageSec <= 300) score += 15;
  else if (ageSec <= 900) score += 8;

  // 2) market cap in the liftoff band (bigger = more confirmed, but still early)
  if (mcUsd >= CONFIG.minMcUsd && mcUsd <= CONFIG.maxMcUsd) score += 20;
  else fail.push(`mc $${Math.round(mcUsd)} out of band`);

  // 3) REAL capital behind it — the strongest signal a coin is live
  if (realSol >= 4) score += 32;
  else if (realSol >= 2.5) score += 26;
  else if (realSol >= CONFIG.minRealSol) score += 18;

  // 4) socials present (legitimacy)
  if (socials.length >= 2) score += 12;
  else if (socials.length === 1) score += 6;

  // 5) engagement forming (replies = attention)
  if (coin.reply_count >= 10) score += 10;
  else if (coin.reply_count >= 3) score += 5;

  // 6) verified / named creator (not throwaway)
  if (coin.verified) score += 6;
  if (coin.username) score += 3;

  const pass =
    fail.length === 0 &&
    socials.length >= CONFIG.minSocials &&
    score >= CONFIG.alertThreshold;

  if (fail.length) reasons.push(`FAIL: ${fail.join(", ")}`);
  if (score >= 25) reasons.push(`early +${Math.min(25, score)}`);
  if (socials.length) reasons.push(`socials:${socials.join("/")}`);
  if (coin.reply_count) reasons.push(`replies:${coin.reply_count}`);

  return {
    mint: coin.mint,
    symbol: coin.symbol,
    name: coin.name,
    pass,
    score: Math.min(100, score),
    reasons,
    createdAgoSec: ageSec,
    mcUsd,
    socials,
  };
}
