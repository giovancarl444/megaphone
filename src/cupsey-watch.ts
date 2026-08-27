/**
 * cupsey-watch — single-whale alert watcher (alerts-only, ms latency).
 *
 * Target: cupsey wallet 6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP
 * Strategy: poll his Solana wallet signatures via public RPC. On a NEW
 * signature not seen before, send an instant Telegram alert to CALLOUT_CHAT.
 *
 * Why on-chain: pump.fun's per-user call API is CF-walled; the leaderboard is
 * 401 via curl. Solana RPC is open and reflects his moves (buys/calls) within
 * seconds of broadcast — the fastest readable signal from this box.
 *
 * Run:
 *   tsx src/cupsey-watch.ts          -> loop forever (poll every CUPSY_POLL_MS)
 *   tsx src/cupsey-watch.ts --once   -> one poll, print report, exit
 *   tsx src/cupsey-watch.ts --selftest -> send one test alert, exit
 */

import { execSync } from "node:child_process";
import { promises as fs, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";
import { CALLOUT_CHAT } from "./config";

const WALLET = "6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP";
const USER_ID = "7adf6201-f91c-4cf6-851d-6e8f520470ed"; // pump.fun userId (resolved)
const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const SEEN_FILE = path.join(DATA_DIR, "cupsey-seen.json");
const POLL_MS = Number(process.env.CUPSY_POLL_MS ?? 8_000);
const RPC = process.env.CUPSY_RPC ?? "https://solana-rpc.publicnode.com";

const HELP = `🔔 CUPSY MOVE\n💎 wallet: ${WALLET.slice(0, 6)}…${WALLET.slice(-4)}\n🔗 solscan: https://solscan.io/account/${WALLET}\n⏱ detected: `;

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(SEEN_FILE, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  fs.writeFile(SEEN_FILE, JSON.stringify([...seen], null, 2)).catch(() => {});
}

async function getSignatures(limit = 5): Promise<{ sig: string; blockTime: number }[]> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getSignaturesForAddress",
    params: [WALLET, { limit }],
  });
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { result?: { signature: string; blockTime?: number }[] };
  return (j.result ?? []).map((r) => ({ sig: r.signature, blockTime: r.blockTime ?? 0 }));
}

function alertText(sig: string, blockTime: number): string {
  const t = new Date(blockTime * 1000).toISOString().slice(11, 19);
  return `${HELP}${t} UTC\n🔗 tx: https://solscan.io/tx/${sig}`;
}

function sendAlert(text: string) {
  try {
    const tmp = path.join(DATA_DIR, `cupsey-alert-${Date.now()}.txt`);
    writeFileSync(tmp, text, "utf8");
    execSync(`hermes send -t ${CALLOUT_CHAT} -f "${tmp}"`, { stdio: "ignore" });
    unlinkSync(tmp);
    console.log(`[cupsey-watch] 🔔 alert sent -> ${CALLOUT_CHAT}`);
  } catch (e) {
    console.error("[cupsey-watch] alert failed:", (e as Error).message);
  }
}

export async function pollOnce(): Promise<{ scanned: number; newAlerts: number }> {
  const sigs = await getSignatures(5);
  const seen = loadSeen();
  let newAlerts = 0;
  // signatures returned newest-first; alert on any unseen
  for (const s of sigs) {
    if (seen.has(s.sig)) continue;
    seen.add(s.sig);
    newAlerts++;
    sendAlert(alertText(s.sig, s.blockTime));
  }
  saveSeen(seen);
  return { scanned: sigs.length, newAlerts };
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--selftest") {
    sendAlert("🧪 CUPSY-WATCH SELFTEST — pipeline live. Watching cupsey on-chain.");
    return;
  }
  if (arg === "--once") {
    const r = await pollOnce();
    console.log("[cupsey-watch] one-shot:", JSON.stringify(r));
    return;
  }
  console.log(`[cupsey-watch] looping every ${POLL_MS / 1000}s | wallet ${WALLET.slice(0, 6)}… | -> ${CALLOUT_CHAT}`);
  const tick = async () => {
    const r = await pollOnce();
    if (r.newAlerts > 0) console.log(`[cupsey-watch] tick newAlerts=${r.newAlerts}`);
  };
  await tick();
  setInterval(tick, POLL_MS);
}

if (import.meta.url.replace(/\\/g, "/").endsWith("/src/cupsey-watch.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
