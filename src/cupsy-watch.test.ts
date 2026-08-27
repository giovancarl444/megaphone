/**
 * Functional test for cupsy-watch detection+alert pipeline.
 * Feeds a SYNTHETIC leaderboard (cupsy entry injected) through the real
 * pollOnce logic and asserts: (1) it detects + alerts, (2) a 2nd run dedups.
 * No external/fake pump.fun data is asserted as real — this tests OUR code.
 */
import { pollOnce, TARGETS } from "./cupsy-watch";
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const SEEN_FILE = path.join(DATA_DIR, "cupsy-seen-test.json");

// fake page whose evaluate returns our synthetic leaderboard
const fakePage: any = {
  evaluate: async (_fn: any, _api: string, _tk: string, _lim: number) => [
    {
      primaryWallet: TARGETS[0].wallet, // cupsy
      wallets: [TARGETS[0].wallet],
      topCallouts: [
        {
          calloutId: "test-callout-1234",
          userId: TARGETS[0].userId,
          coinMint: "CuP5yTESTmint111111111111111111111111111pump",
          marketCap: 12345,
          multiple: 42.5,
          thesis: "TEST CALL — insider signal pipeline check",
        },
      ],
    },
  ],
};

async function main() {
  // clean state
  await fs.rm(SEEN_FILE, { force: true });
  const token = "test-token";

  console.log("=== RUN 1 (expect 1 alert) ===");
  const r1 = await pollOnce(fakePage, token);
  console.log("result:", JSON.stringify(r1));
  if (r1.alerts !== 1) throw new Error("RUN1 FAILED: expected 1 alert");

  console.log("=== RUN 2 (expect 0 alerts — dedup) ===");
  const r2 = await pollOnce(fakePage, token);
  console.log("result:", JSON.stringify(r2));
  if (r2.alerts !== 0) throw new Error("RUN2 FAILED: dedup broken, re-alerted");

  // verify seen file persisted
  const seen = JSON.parse(await fs.readFile(SEEN_FILE, "utf8")) as string[];
  if (!seen.includes("test-callout-1234")) throw new Error("seen file missing the calloutId");

  await fs.rm(SEEN_FILE, { force: true });
  console.log("\n✅ cupsy-watch detection+alert+dedup pipeline VERIFIED");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
