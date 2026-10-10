/**
 * path-recorder.mjs — PAPER ONLY. Records the real price PATH of every callout.
 *
 * WHY: the trailing-stop finding is only as good as its path data. rewards.jsonl stores
 * peak + current ONLY, so a backtest cannot see a call that dipped before it ran. This
 * appends one observation batch per run, so grouping by mint yields the actual path.
 *
 * READ-ONLY: a GET of the founder's callout list through the logged-in CDP Chrome.
 * No trades, no wallet, no posting, no money.
 *
 * Run:  node src/path-recorder.mjs          (cron-friendly; one batch per run)
 * Out:  .megaphone/callout-paths.jsonl      one JSON line per run
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const CDP_PORT = process.env.CDP_PORT || "9223";
const USER_ID = process.env.PUMP_USER_ID || "4ac11d85-afce-47cb-9c81-8345400351b4";
const DATA_DIR = path.join(process.cwd(), ".megaphone");
const OUT = path.join(DATA_DIR, "callout-paths.jsonl");

async function cdpEval(expression) {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page =
    list.find((t) => t.type === "page" && (t.url || "").includes("pump.fun")) ||
    null;
  if (!page) throw new Error("no pump.fun tab open in CDP Chrome (open one first)");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  ws.close();
  return res?.result?.value;
}

const raw = await cdpEval(`(async () => {
  try {
    const r = await fetch('https://frontend-api-v3.pump.fun/callout/list/${USER_ID}?limit=50&sortBy=TIMESTAMP&sortOrder=desc', {
      credentials: 'include', headers: { 'Content-Type': 'application/json' }
    });
    if (!r.ok) return { error: 'HTTP ' + r.status };
    return await r.json();
  } catch (e) { return { error: String(e && e.message || e) }; }
})()`);

if (!raw || raw.error) {
  console.error("FETCH FAILED:", raw && raw.error);
  process.exit(1);
}

const items = raw.callouts || raw.data || raw || [];
const ts = Date.now();
const rows = items.map((c) => ({
  mint: c.coinMint || c.mint || "",
  now: Number(c.multiple) || 0,
  peak: Number(c.maxMultiplier || c.multiple) || 0,
  mc: Number(c.marketCap) || 0,
  createdAt: c.createdAt || c.created_at || 0,
}));

mkdirSync(DATA_DIR, { recursive: true });
appendFileSync(OUT, JSON.stringify({ ts, n: rows.length, rows }) + "\n");
console.log(`recorded ${rows.length} callouts @ ${new Date(ts).toISOString()} -> ${OUT}`);
