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
