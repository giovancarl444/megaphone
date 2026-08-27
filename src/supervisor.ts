import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(ROOT, "..", ".daemon.out.log");
const tsx = path.join(ROOT, "..", "node_modules", "tsx", "dist", "cli.mjs");
const watch = path.join(ROOT, "watch.ts");
const cupsy = path.join(ROOT, "cupsy-watch.ts");

/**
 * Supervisor: keeps the firehose watcher alive forever.
 * Restarts on crash, rotates the log so output never stalls,
 * and surfaces a heartbeat so we know it's alive.
 */
async function start() {
  let proc: any = null;
  let restarts = 0;

  const launch = () => {
    proc = spawn(process.execPath, [tsx, watch], {
      cwd: path.join(ROOT, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const tag = `[${new Date().toISOString()}] `;
    proc.stdout.on("data", (d: Buffer) => fs.appendFile(LOG, tag + d.toString()));
    proc.stderr.on("data", (d: Buffer) => fs.appendFile(LOG, tag + "[err] " + d.toString()));
    proc.on("exit", (code: number) => {
      restarts++;
      console.error(`[supervisor] watch exited ${code} (restart #${restarts}) — relaunching in 5s`);
      setTimeout(launch, 5000);
    });
  };

  const launchCupsy = () => {
    const cp = spawn(process.execPath, [tsx, cupsy], {
      cwd: path.join(ROOT, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const tag = `[${new Date().toISOString()}] [cupsy] `;
    cp.stdout.on("data", (d: Buffer) => fs.appendFile(LOG, tag + d.toString()));
    cp.stderr.on("data", (d: Buffer) => fs.appendFile(LOG, tag + "[err] " + d.toString()));
    cp.on("exit", (code: number) => {
      console.error(`[supervisor] cupsy-watch exited ${code} — relaunching in 10s`);
      setTimeout(launchCupsy, 10_000);
    });
  };

  launch();
  launchCupsy();

  // heartbeat + resolve-loop driver in the supervisor itself
  const tick = async () => {
    try {
      const { resolveLoop } = await import("./resolve-loop");
      await resolveLoop();
    } catch (e) {
      console.error("[supervisor] resolve-loop error:", (e as Error).message);
    }
    try {
      const { resolvePaperTrades } = await import("./paper-scalp");
      await resolvePaperTrades();
    } catch (e) {
      console.error("[supervisor] scalp error:", (e as Error).message);
    }
  };
  await tick();
  setInterval(tick, 60_000);

  // whale-mirror: pull proven winning calls from the leaderboard every 30 min
  const mirrorTick = async () => {
    try {
      const { mirrorLeaderboard } = await import("./leaderboard-mirror");
      await mirrorLeaderboard(50);
    } catch (e) {
      console.error("[supervisor] mirror error:", (e as Error).message);
    }
  };
  setTimeout(mirrorTick, 30_000); // first pull shortly after start
  setInterval(mirrorTick, 30 * 60_000);

  // heartbeat
  setInterval(() => {
    const t = new Date().toISOString();
    fs.appendFile(LOG, `[${t}] [heartbeat] alive, restarts=${restarts}\n`);
  }, 300_000);
}

start().catch((e) => {
  console.error("[supervisor] fatal", e);
  process.exit(1);
});
