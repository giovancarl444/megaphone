/**
 * cupsy-watch — insider-signal watcher (PHASE 1: alerts-only, box-readable).
 *
 * Product framing (ellio, 08-27):
 *   "The best insider trading signals (then paper, then real money) based on
 *    whale / cabal wallet addresses. Starting with cupsy to test functionality."
 *
 * Reality from this datacenter box (proven by live probes):
 *   - cupsy's OWN call list is NOT readable (401 / 404 / CF-walled).
 *   - The only cupsy-readable signal is the public callout LEADERBOARD
 *     (GET /callout/leaderboard, 200 from box via browser). If/when cupsy's
 *     calls surface there, we detect + alert instantly.
 *   - True 0ms live calls need a trusted/residential IP (MEGAPHONE_PROXY) —
 *     that's PHASE 2, same detection logic, different fetch source.
 *
 * This module:
 *   1. Polls the leaderboard every CUPSY_POLL_MS (default 60s).
 *   2. Matches any callout whose wallet/userId == a TARGET wallet.
 *   3. On a NEW (unseen) cupsy callout: sends a Telegram alert to FOUNDER_CHAT
 *      and logs it. No posting, no paper, no real money — alerts only.
 *   4. Persists seen calloutIds so restarts don't re-alert.
 *
 * Run:
 *   tsx src/cupsy-watch.ts            -> loop forever
 *   tsx src/cupsy-watch.ts --once     -> one poll, print report, exit
 *   tsx src/cupsy-watch.ts --selftest -> send one test alert, exit
 */

import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FOUNDER_CHAT } from "./config";

const API = "https://frontend-api-v3.pump.fun";
const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");

// config.ts's token loader is broken under ESM (require returns ""), so load
// the JWT directly here. Works from box with the persisted token.json.
function loadToken(): string {
  if (process.env.PUMPFUN_TOKEN) return process.env.PUMPFUN_TOKEN;
  try {
    const raw = readFileSync(path.join(DATA_DIR, "token.json"), "utf8");
    return (JSON.parse(raw).token as string) ?? "";
  } catch {
    return "";
  }
}
const PUMPFUN_TOKEN = loadToken();

const SEEN_FILE = path.join(DATA_DIR, "cupsy-seen.json");
const POLL_MS = Number(process.env.CUPSY_POLL_MS ?? 60_000);
const LIMIT = Number(process.env.CUPSY_LIMIT ?? 200);

/**
 * TARGET whale/cabal wallets we alert on. cupsy is the test wallet.
 * `wallet` is matched against leaderboard entry.primaryWallet / wallets[].
 * `userId` is matched against each callout's userId (when present).
 */
export const TARGETS: { handle: string; wallet: string; userId?: string }[] = [
  { handle: "cupsy", wallet: "3tL1nfq5tb9RfydszNwMytYAZrnD3gpkmxxcdTvpPS6S", userId: "5ca1a721-b997-41de-92be-02978f08f240" },
  // add more cabal wallets here as the system expands
];

interface LbCallout {
  calloutId: string;
  userId?: string;
  user_uuid?: string;
  coinMint: string;
  marketCap?: number;
  calloutPriceUsd?: number;
  multiple?: number;
  createdAt?: number;
  thesis?: string;
}
interface LbEntry {
  primaryWallet: string;
  wallets?: string[];
  topCallouts?: LbCallout[];
}

function loadSeenAsync(): Promise<Set<string>> {
  return import("node:fs/promises")
    .then((mod) => mod.readFile(SEEN_FILE, "utf8"))
    .then((raw) => new Set(JSON.parse(raw) as string[]))
    .catch(() => new Set<string>());
}
function saveSeen(seen: Set<string>) {
  fs.writeFile(SEEN_FILE, JSON.stringify([...seen], null, 2)).catch(() => {});
}

function matchTarget(c: LbCallout, entry: LbEntry): { handle: string } | null {
  const wallets = [entry.primaryWallet, ...(entry.wallets ?? [])].map((w) => (w || "").toLowerCase());
  for (const t of TARGETS) {
    if (wallets.includes(t.wallet.toLowerCase())) return { handle: t.handle };
    if (t.userId && (c.userId === t.userId || c.user_uuid === t.userId)) return { handle: t.handle };
  }
  return null;
}

function alertText(t: { handle: string }, c: LbCallout): string {
  const sym = c.coinMint.slice(0, 6);
  const mult = c.multiple != null ? `${c.multiple.toFixed(1)}x` : "?";
  const mc = c.marketCap != null ? `$${Math.round(c.marketCap).toLocaleString()}` : "?";
  const thesis = (c.thesis || "").slice(0, 140).replace(/\n+/g, " ");
  return (
    `🔔 ${t.handle.toUpperCase()} CALL (leaderboard)\n` +
    `💎 $${sym}\n` +
    `📊 ${mult} · mc ${mc}\n` +
    (thesis ? `💡 ${thesis}\n` : "") +
    `🔗 pump.fun/coin/${c.coinMint}`
  );
}

async function fetchLeaderboard(page: any, token: string, limit: number): Promise<LbEntry[]> {
  return page.evaluate(
    async (api: string, tk: string, lim: number) => {
      const res = await fetch(`${api}/callout/leaderboard?limit=${lim}`, {
        headers: { Authorization: `Bearer ${tk}`, Accept: "application/json", Origin: "https://pump.fun" },
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j.callouts as any[];
    },
    API, token, limit,
  );
}

async function sendAlert(text: string): Promise<void> {
  try {
    const { execSync } = await import("node:child_process");
    execSync(`hermes send --to ${FOUNDER_CHAT} ${JSON.stringify(text)}`, { stdio: "ignore" });
  } catch (e) {
    console.error("[cupsy-watch] alert send failed:", (e as Error).message);
  }
}

export async function pollOnce(page: any, token: string): Promise<{ scanned: number; hits: number; alerts: number }> {
  const entries = await fetchLeaderboard(page, token, LIMIT);
  if (!entries) {
    console.log("[cupsy-watch] leaderboard fetch failed (null)");
    return { scanned: 0, hits: 0, alerts: 0 };
  }
  const seen = await loadSeenAsync();
  let scanned = 0;
  let hits = 0;
  let alerts = 0;
  for (const entry of entries) {
    for (const c of entry.topCallouts ?? []) {
      scanned++;
      const m = matchTarget(c, entry);
      if (!m) continue;
      hits++;
      if (seen.has(c.calloutId)) continue;
      seen.add(c.calloutId);
      alerts++;
      const text = alertText(m, c);
      console.log(`[cupsy-watch] 🔔 ALERT ${m.handle}: ${c.coinMint} ${c.multiple?.toFixed(1)}x`);
      await sendAlert(text);
    }
  }
  saveSeen(seen);
  return { scanned, hits, alerts };
}

async function main() {
  const arg = process.argv[2];
  if (!PUMPFUN_TOKEN) {
    console.log("[cupsy-watch] NO PUMPFUN_TOKEN — cannot read leaderboard. Exiting.");
    process.exit(1);
  }
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto("https://pump.fun", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 5000));

    if (arg === "--selftest") {
      console.log("[cupsy-watch] self-test: sending one test alert");
      await sendAlert("🧪 CUPSY-WATCH SELFTEST — pipeline live. Watching: " + TARGETS.map((t) => t.handle).join(", "));
      console.log("[cupsy-watch] self-test done");
      return;
    }

    if (arg === "--once") {
      const r = await pollOnce(page, PUMPFUN_TOKEN);
      console.log("[cupsy-watch] one-shot:", JSON.stringify(r));
      // also report leaderboard size + whether any target wallet is present at all
      const entries = await fetchLeaderboard(page, PUMPFUN_TOKEN, LIMIT);
      const present = TARGETS.filter((t) =>
        (entries ?? []).some((e) =>
          [e.primaryWallet, ...(e.wallets ?? [])].map((w) => (w || "").toLowerCase()).includes(t.wallet.toLowerCase()),
        ),
      ).map((t) => t.handle);
      console.log(`[cupsy-watch] leaderboard entries=${entries?.length ?? 0}, targets present now=${present.join(",") || "none"}`);
      return;
    }

    console.log(`[cupsy-watch] looping every ${POLL_MS / 1000}s, targets=${TARGETS.map((t) => t.handle).join(",")}`);
    const tick = async () => {
      const r = await pollOnce(page, PUMPFUN_TOKEN);
      console.log(`[cupsy-watch] tick scanned=${r.scanned} hits=${r.hits} alerts=${r.alerts}`);
    };
    await tick();
    setInterval(tick, POLL_MS);
  } finally {
    if (arg !== "--once" && arg !== "--selftest") {
      // keep browser alive in loop mode; never reached until SIGINT
    } else {
      await browser.close();
    }
  }
}
if (import.meta.url.replace(/\\/g, "/").endsWith("/src/cupsy-watch.ts")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
