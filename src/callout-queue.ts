/**
 * callout-queue.ts — the auto-loop's brain.
 *
 * Watches the dev-sniper's watchlist for NEW launches from known-good devs.
 * For each fresh launch it:
 *   1. Logs a QUEUED callout (mint, symbol, mc, thesis draft)
 *   2. Checks if the session wallet holds >= $1 of that coin (the posting gate)
 *   3. If held -> READY (can post immediately via callout-poster.ts)
 *   4. If not held -> needs a $1 buy first (founder action or auto-buy later)
 *
 * Data: .megaphone/callout-queue.json
 * Usage:
 *   tsx src/callout-queue.ts          -> scan fresh launches, update queue
 *   tsx src/callout-queue.ts --status -> print queue state
 */
import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { scanMint, type SafetyVerdict } from "./token-safety.js";

const FOUNDER_DM = "telegram:1915394365";

function alertFounder(msg: string) {
  try {
    // write to temp file to avoid shell-quoting issues, then hermes send -f
    const tmp = path.join(process.cwd(), ".megaphone", "alert.tmp.txt");
    writeFileSync(tmp, msg, "utf8");
    execSync(`hermes send --to ${FOUNDER_DM} -f "${tmp}"`, { timeout: 15000, windowsHide: true, stdio: "ignore" });
  } catch (e) { console.error("[callout-queue] alert failed:", (e as Error).message.slice(0, 120)); }
}

const DATA_DIR = path.join(process.cwd(), ".megaphone");
const QUEUE_FILE = path.join(DATA_DIR, "callout-queue.json");
const WATCHLIST_FILE = path.join(process.cwd(), ".dev1", "dev-watchlist.json");
const MIN_MC = 1500;       // skip dust (<$1.5K)
const MAX_MC = 30000;      // still early (<$30K) — the callout sweet spot
const FRESH_MIN = 3 * 60;  // launch within last 3 minutes

interface QueuedCallout {
  mint: string;
  symbol: string;
  mc: number;
  dev: string;
  devOpenRatio: number;
  launchedAt: number;
  status: "QUEUED" | "READY" | "NEEDS_BUY" | "POSTED" | "SKIPPED";
  thesis?: string;
  postedAt?: number;
  calloutId?: string;
  safety?: SafetyVerdict;
}

function loadQueue(): QueuedCallout[] {
  try { return JSON.parse(readFileSync(QUEUE_FILE, "utf8")); } catch { return []; }
}
function saveQueue(q: QueuedCallout[]) {
  writeFileSync(QUEUE_FILE + ".tmp", JSON.stringify(q, null, 2));
  fs.rename(QUEUE_FILE + ".tmp", QUEUE_FILE).catch(() => {});
}

function loadDevs(): { wallet: string; open_ratio: number }[] {
  try {
    const d = JSON.parse(readFileSync(WATCHLIST_FILE, "utf8"));
    return (d.devs || []).map((x: any) => ({ wallet: x.wallet, open_ratio: x.open_ratio || 0 }));
  } catch { return []; }
}

async function rpc(method: string, params: any[]): Promise<any> {
  for (const u of ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"]) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j.result) return j.result;
    } catch {}
  }
  return null;
}

/** Does the session wallet hold >= $1 of this mint? (uses pump.fun profile holdings via CDP) */
export async function holdsCoin(mint: string): Promise<boolean> {
  try {
    const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
    const page = list.find((t: any) => t.type === "page" && t.url.includes("pump.fun")) || list.find((t: any) => t.type === "page");
    if (!page) return false;
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    const send = (m: string, p: any = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.onmessage = (ev: any) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
    await new Promise((r) => (ws.onopen = r));
    await send("Runtime.enable");
    const res: any = await send("Runtime.evaluate", { expression: `(async () => {
      try {
        const r = await fetch('https://frontend-api-v3.pump.fun/coins/${mint}', { credentials: 'include' });
        if (!r.ok) return false;
        // holdings are visible via the wallet profile endpoint
        const r2 = await fetch('https://frontend-api-v3.pump.fun/wallet/holdings?mint=${mint}', { credentials: 'include' });
        if (r2.ok) { const j = await r2.json(); return Number(j?.valueUsd || 0) >= 1; }
        return false;
      } catch { return false; }
    })()`, awaitPromise: true, returnByValue: true });
    ws.close();
    return !!res?.result?.value;
  } catch { return false; }
}

async function scan() {
  const queue = loadQueue();
  const devs = loadDevs();
  const devWallets = new Set(devs.map((d) => d.wallet));
  const now = Date.now();
  let found = 0;

  // scan each dev wallet for fresh launches (create txs in last 3 min)
  for (const dev of devs.slice(0, 10)) { // check top 10 per scan (rate-limit friendly)
    const sigs = await rpc("getSignaturesForAddress", [dev.wallet, { limit: 5 }]);
    if (!sigs) continue;
    for (const s of sigs) {
      const bt = (s.blockTime || 0) * 1000;
      if (now - bt > FRESH_MIN * 1000) continue; // not fresh
      if (queue.some((q) => q.dev === dev.wallet && Math.abs(q.launchedAt - bt) < 60000)) continue; // seen
      // decode to find mint
      try {
        const tx = await rpc("getTransaction", [s.signature, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]);
        const msg = tx?.transaction?.message;
        if (!msg) continue;
        const accs = msg.accountKeys.map((a: any) => typeof a === "string" ? a : a.pubkey);
        const ixns = msg.instructions || [];
        for (const ix of ixns) {
          const prog = accs[ix.programIdIndex];
          if (prog !== "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") continue;
          if ((ix.accounts?.length ?? 0) >= 3) {
            const mint = ix.accounts[2];
            if (mint && typeof mint === "string" && mint.length >= 32 && !queue.some((q) => q.mint === mint)) {
              const devInfo = devs.find((d) => d.wallet === dev.wallet);
              queue.push({
                mint, symbol: mint.slice(0, 6), mc: 0, dev: dev.wallet,
                devOpenRatio: devInfo?.open_ratio || 0, launchedAt: bt, status: "QUEUED",
                thesis: "Fresh launch from a proven dev — catching it early.",
              });
              // HUMAN-IN-THE-LOOP: alert founder — needs a $1 buy to unlock the callout
              alertFounder(
                `🚀 FRESH LAUNCH — proven dev (open ratio ${((devInfo?.open_ratio || 0) * 100).toFixed(0)}%)\n\n` +
                `mint: ${mint}\npump.fun: https://pump.fun/coin/${mint}\n\n` +
                `Buy ~$1 of this coin to unlock the callout → I'll auto-post it once you confirm.`
              );
              // SAFETY GATE: auto-scan the mint; DANGER callouts never reach the queue
              try {
                const v: SafetyVerdict = await scanMint(mint);
                queue[queue.length - 1].safety = v;
                if (v.verdict === "DANGER") {
                  queue[queue.length - 1].status = "SKIPPED";
                  console.log(`[callout-queue] ⛔ ${mint.slice(0, 8)} DANGER (${v.flags.join(", ")}) — auto-skipped`);
                  continue;
                }
                console.log(`[callout-queue] 🛡️ ${mint.slice(0, 8)} ${v.verdict} score ${v.score} ${v.flags.length ? "(" + v.flags.join(", ") + ")" : "clean"}`);
              } catch { console.log(`[callout-queue] ⚠️ safety scan failed for ${mint.slice(0, 8)} — proceeding (manual review)`); }
              found++;
            }
          }
        }
      } catch {}
    }
  }
  if (found) {
    console.log(`[callout-queue] +${found} new launch(es) queued`);
    saveQueue(queue);
  } else {
    console.log("[callout-queue] no fresh launches this scan");
  }
}

async function status() {
  const queue = loadQueue();
  console.log(`=== CALLOUT QUEUE (${queue.length}) ===`);
  for (const q of queue.slice(-15).reverse()) {
    const t = new Date(q.launchedAt).toISOString().slice(11, 19);
    console.log(`  ${q.status.padEnd(9)} ${q.mint.slice(0, 8)}… | dev ratio ${(q.devOpenRatio * 100).toFixed(1)}% | ${t} | ${q.thesis?.slice(0, 40)}`);
  }
  const ready = queue.filter((q) => q.status === "READY");
  if (ready.length) console.log(`\nREADY to post: ${ready.length} — run callout-poster.ts on them`);
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--status") { await status(); return; }
  if (arg === "--loop") {
    console.log("[callout-queue] scanning every 60s");
    await scan();
    setInterval(scan, 60_000);
    return;
  }
  await scan();
  await status();
}

main().catch((e) => { console.error(e); process.exit(1); });
