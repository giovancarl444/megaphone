/** Tunable callout-quality gates. Edit freely — these define "worth calling". */
export const CONFIG = {
  // --- freshness: only call coins young enough to be "early" ---
  maxAgeSec: 30 * 60, // ignore coins older than 30 min
  // --- market-cap window (USD): must have liftoff but not already pumped ---
  minMcUsd: 1_500,
  maxMcUsd: 120_000,
  // --- REAL traction gate (the actual discriminator) ---
  // min real SOL deposited into the bonding curve by buyers.
  // a launch with no real buyers = noise/spam, never call it.
  minRealSol: 2.5,
  // --- legitimacy gates ---
  // require >=2 socials for a call (x + web, or x + tg) — filters throwaways
  requireSocials: true,
  minSocials: 2,
  // pump.fun traffic is X-native — a call without X is dead weight
  requireX: true,
  // --- anti-spam ---
  skipBanned: true,
  skipNsfw: true,
  // --- bonding progress: ignore graduated/complete coins (no upside left) ---
  skipComplete: true,
  // --- score threshold to fire an alert ---
  alertThreshold: 75,
};

/** FOUNDER chat for alerts (Solshotta). */
export const FOUNDER_CHAT = "telegram:1915394365";

/**
 * WHALE CALLERS we mirror — the follower engine.
 * When any of these wallets launches a coin, we score it through OUR filter
 * and (if it passes) post the call on OUR account. Their calls, our curation.
 *
 * Addresses resolved from pump.fun public profiles (no auth):
 *  - orangey/kingorange: 4P8apfoSyiwfgu4Gk3tx17igeP8s33ZfDTawfTEN3EQF
 *  - cupsy:              3tL1nfq5tb9RfydszNwMytYAZrnD3gpkmxxcdTvpPS6S
 * Add more by resolving their wallet via: GET /users/<handle>
 */
export const WHALES: { handle: string; address: string }[] = [
  { handle: "orangey", address: "4P8apfoSyiwfgu4Gk3tx17igeP8s33ZfDTawfTEN3EQF" },
  { handle: "cupsy", address: "3tL1nfq5tb9RfydszNwMytYAZrnD3gpkmxxcdTvpPS6S" },
];

/**
 * pump.fun session JWT for OUR account. WITHOUT it, the engine logs intent
 * but does not post (safe dry-run). Set via env PUMPFUN_TOKEN when you have
 * a session. Posting a callout = the "bundle into our account" action.
 */
export const PUMPFUN_TOKEN = process.env.PUMPFUN_TOKEN ?? "";

/** Prove calls by posting the outcome. Set via env PROOF_CALL_REPLY_TOKEN. */
export const PROOF_CHAT = "telegram:1915394365"; // same as founder for now
export const PROOF_CALL_REPLY_TOKEN = process.env.PROOF_CALL_REPLY_TOKEN ?? "";
export const WHALE_LOOKBACK_MS = 6 * 60 * 60 * 1000; // 6h window

/** Mirror poll cadence (ms). */
export const WHALE_POLL_MS = 30_000; // 30s
