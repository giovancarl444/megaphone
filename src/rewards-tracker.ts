/**
 * rewards-tracker.ts — pull YOUR pump.fun callouts + track their multiples/payout basis.
 * Reads from the authenticated browser session via CDP (same auth as the poster).
 * Data source: GET /callout/list/{userId}?sortBy=TIMESTAMP  (VERIFIED live)
 *
 * Usage:
 *   tsx src/rewards-tracker.ts            -> one-shot, print summary
 *   tsx src/rewards-tracker.ts --loop     -> poll every 5 min, append to .megaphone/rewards.jsonl
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";

const CDP_PORT = process.env.CDP_PORT || "9223";
const USER_ID = "4ac11d85-afce-47cb-9c81-8345400351b4"; // BT7bQZmX (drew_patel)
const DATA_DIR = path.join(process.cwd(), ".megaphone");
const REWARDS_LOG = path.join(DATA_DIR, "rewards.jsonl");

async function cdpEvaluate(expression: string): Promise<any> {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((t: any) => t.type === "page" && t.url.includes("pump.fun")) || list.find((t: any) => t.type === "page");
  if (!page) throw new Error("no pump.fun page in Chrome");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method: string, params: any = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (ev: any) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  const res: any = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  ws.close();
  return res?.result?.value;
}

/** Fetch the user's callouts (timestamp-sorted, newest first). */
export async function fetchMyCallouts(): Promise<any[]> {
  const out = await cdpEvaluate(`(async () => {
    try {
      const r = await fetch('https://frontend-api-v3.pump.fun/callout/list/${USER_ID}?limit=50&sortBy=TIMESTAMP&sortOrder=desc', {
        credentials: 'include', headers: { 'Content-Type': 'application/json' }
      });
      if (!r.ok) return { error: 'HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200) };
      return await r.json();
    } catch (e) { return { error: e.message }; }
  })()`);
  return out;
}

function summarize(callouts: any[]): any {
  const rows = (callouts || []).map((c: any) => ({
    mint: c.coinMint || c.mint || "",
    symbol: c.symbol || "",
    mc: c.marketCap || 0,
    multiple: c.multiple || 1,
    maxMult: c.maxMultiplier || c.multiple || 1,
    maxMultAt: c.maxMultiplierAt || 0,
    views: c.viewCount || 0,
    likes: c.likes || 0,
    reposts: c.repostCount || 0,
    comments: c.commentCount || 0,
    thesis: (c.thesis || "").slice(0, 50),
    createdAt: c.createdAt || 0,
    resolved: c.resolved || false,
  }));
  const active = rows.filter((r) => !r.resolved);
  const resolved = rows.filter((r) => r.resolved);
  const best = rows.reduce((m, r) => (r.maxMult > m.maxMult ? r : m), rows[0] || { maxMult: 0 });
  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  return { total: rows.length, active: active.length, resolved: resolved.length, best: best.maxMult || 0, totalViews, rows };
}

export async function runOnce(): Promise<any> {
  const data: any = await fetchMyCallouts();
  if (data?.error) return { error: data.error };
  const s = summarize(data?.callouts || data?.list || data);
  // append to log
  const rec = { ts: Date.now(), ...s };
  appendFileSync(REWARDS_LOG, JSON.stringify(rec) + "\n");
  return s;
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--loop") {
    console.log(`[rewards-tracker] polling every 5min -> ${REWARDS_LOG}`);
    const tick = async () => {
      try {
        const s = await runOnce();
        if (s.error) console.error("[rewards-tracker] err:", s.error);
        else console.log(`[rewards-tracker] ${s.total} callouts | ${s.active} active | ${s.resolved} resolved`);
      } catch (e) { console.error("[rewards-tracker] err:", (e as Error).message); }
    };
    await tick();
    setInterval(tick, 5 * 60 * 1000);
    return;
  }
  const s = await runOnce();
  if (s.error) { console.error("ERROR:", s.error); process.exit(1); }
  console.log(`=== YOUR CALLOUTS (${s.total}) ===`);
  console.log(`active: ${s.active} | resolved: ${s.resolved} | best maxMult: ${s.best}x | total views: ${s.totalViews}`);
  for (const r of s.rows.slice(0, 15)) {
    const d = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 16) : "?";
    console.log(`  ${r.resolved ? "✅" : "🕐"} ${r.symbol || r.mint.slice(0, 8)} | mc $${r.mc} | now x${r.multiple.toFixed(2)} peak x${r.maxMult.toFixed(2)} | 👁${r.views} 👍${r.likes} | ${d} | ${r.thesis}`);
  }
}

if (process.argv[1]?.endsWith("rewards-tracker.ts")) main();
