import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getTrackRecord, recentCallouts } from "./leaderboard";
import { PUMPFUN_TOKEN } from "./config";

const DATA_DIR = () => process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");

/**
 * Telegram command interface for the engine.
 * The founder texts commands to the bot; this handles them.
 *
 * Commands:
 *   /status   -> ledger size, track record, token present?
 *   /cookie <cookie string>  -> save CF cookies (enables posting)
 *   /calls    -> list recent calls
 *   /stop /start -> note daemon state (actual stop/start handled by process mgr)
 */
export async function handleTelegramCommand(text: string): Promise<string> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");

  switch (cmd.toLowerCase()) {
    case "/status": {
      const tr = await getTrackRecord();
      const cookie = await loadCookieFlag();
      return [
        "📡 MEGAPHONE status",
        `token: ${PUMPFUN_TOKEN ? "✅ live" : "❌ none"}`,
        `cf cookies: ${cookie ? "✅ live" : "❌ none (posting disabled)"}`,
        `calls logged: ${tr.total}`,
        `resolved: ${tr.resolved} · win-rate: ${(tr.winRate * 100).toFixed(0)}%`,
        `avg multiple: ${tr.avgMultiple.toFixed(2)}x · best: ${tr.bestMultiple.toFixed(2)}x`,
      ].join("\n");
    }
    case "/cookie": {
      if (!arg) return "❌ usage: /cookie <paste browser cookie string here>";
      try {
        await fs.writeFile(path.join(DATA_DIR(), "cookies.json"), arg.trim(), { mode: 0o600 });
        return "✅ cookies saved — posting to pump.fun is now ENABLED";
      } catch (e) {
        return `❌ could not save cookies: ${(e as Error).message}`;
      }
    }
    case "/calls": {
      const calls = await recentCallouts(10);
      if (!calls.length) return "no calls yet";
      return calls
        .map((c) => `${c.symbol} ${c.score} · $${c.calledMcUsd} · ${c.mint.slice(0, 8)}…`)
        .join("\n");
    }
    case "/digest": {
      // top proven winners — ready to post manually if CF blocks auto-posting
      const calls = await recentCallouts(500);
      const wins = calls
        .filter((c) => (c.multiple ?? 0) >= 1.5)
        .sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))
        .slice(0, 5);
      if (!wins.length) return "no proven winners yet — mirror still warming up";
      const lines = wins.map((c, i) => {
        const thesis = (c.reasons.find((r) => r.startsWith("thesis:")) ?? "").replace("thesis: ", "");
        return `${i + 1}. $${c.symbol} — ${c.multiple?.toFixed(1)}x (called @ $${Math.round(c.calledMcUsd)})\n   ${thesis || c.reasons.join(" ")}\n   pump.fun/coin/${c.mint}`;
      });
      return "🔥 TOP PROVEN CALLS (copy-paste to pump.fun if auto-post is blocked):\n\n" + lines.join("\n\n");
    }
    case "/broadcast": {
      // send the top proven calls to the Telegram callout feed right now
      const { broadcastBatch } = await import("./broadcast");
      const calls = await recentCallouts(500);
      const wins = calls
        .filter((c) => (c.multiple ?? 0) >= 1.5)
        .sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))
        .slice(0, parseInt(arg || "5", 10));
      const n = broadcastBatch(wins);
      return `📡 broadcasted ${n} proven calls to the feed`;
    }
    case "/stop":
      return "⏸ send via process manager. On Windows: stop the daemon task or kill tsx src/daemon.ts";
    case "/start":
      return "▶ restart: `npm run daemon` in D:\\megaphone";
    default:
      return [
        "MEGAPHONE commands:",
        "/status — ledger + track record",
        "/cookie <str> — paste browser cookies to enable posting",
        "/calls — recent calls",
        "/digest — top proven calls (ready to post)",
        "/broadcast [n] — send top n proven calls to the feed now",
        "/stop /start — daemon control",
      ].join("\n");
  }
}

async function loadCookieFlag(): Promise<boolean> {
  try {
    await fs.access(path.join(DATA_DIR(), "cookies.json"));
    return true;
  } catch {
    return false;
  }
}

// run: tsx src/tg-commands.ts "/status"
if (import.meta.url.replace(/\\/g, "/").endsWith("/src/tg-commands.ts")) {
  const t = process.argv[2] ?? "/status";
  handleTelegramCommand(t).then((r) => console.log(r));
}
