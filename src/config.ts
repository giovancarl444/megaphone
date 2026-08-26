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
  minRealSol: 1.5,
  // --- legitimacy gates ---
  // require >=2 socials for a call (x + web, or x + tg) — filters throwaways
  requireSocials: true,
  minSocials: 2,
  // --- anti-spam ---
  skipBanned: true,
  skipNsfw: true,
  // --- bonding progress: ignore graduated/complete coins (no upside left) ---
  skipComplete: true,
  // --- score threshold to fire an alert ---
  alertThreshold: 65,
  // --- quiet window so we don't re-alert the same mint ---
  // (handled by watch.ts dedupe set)
};

/** FOUNDER chat for alerts (Solshotta). */
export const FOUNDER_CHAT = "telegram:1915394365";
