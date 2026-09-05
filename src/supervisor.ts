import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs, appendFileSync, writeFileSync } from "node:fs";

const TRACE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".supervisor.trace.log");
const trace = (m: string) => { try { appendFileSync(TRACE, `[${new Date().toISOString()}] ${m}\n`); } catch {} };
process.on("beforeExit", (c) => trace(`beforeExit code=${c} stack=${new Error("be").stack}`));
process.on("exit", (c) => trace(`exit code=${c}`));
trace("module loaded");

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(ROOT, "..", ".daemon.out.log"); // supervisor's own stdout (shell-owned)
const WATCH_LOG = path.join(ROOT, "..", ".watch.out.log");
const CUPSEY_LOG = path.join(ROOT, "..", ".cupsey.out.log");
const SNIPER_LOG = path.join(ROOT, "..", ".sniper.out.log");
const tsx = path.join(ROOT, "..", "node_modules", "tsx", "dist", "cli.mjs");
const watch = path.join(ROOT, "watch.ts");
const cupsey = path.join(ROOT, "cupsey-watch.ts"); // E-file = REAL on-chain watcher (all fixes)
const sniper = path.join(ROOT, "sniper.ts"); // paper-first launch sniper (flag: MEGAPHONE_SNIPER=1)

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
    proc.stdout.on("data", (d: Buffer) => fs.appendFile(WATCH_LOG, tag + d.toString()));
    proc.stderr.on("data", (d: Buffer) => fs.appendFile(WATCH_LOG, tag + "[err] " + d.toString()));
    proc.on("exit", (code: number) => {
      restarts++;
      console.error(`[supervisor] watch exited ${code} (restart #${restarts}) — relaunching in 5s`);
      setTimeout(launch, 5000);
    });
  };

  const launchCupsey = () => {
    const cp = spawn(process.execPath, [tsx, cupsey], {
      cwd: path.join(ROOT, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MEGAPHONE_WATCHLIST: "1" },
    });
    const tag = `[${new Date().toISOString()}] [cupsey] `;
    cp.stdout.on("data", (d: Buffer) => fs.appendFile(CUPSEY_LOG, tag + d.toString()));
    cp.stderr.on("data", (d: Buffer) => fs.appendFile(CUPSEY_LOG, tag + "[err] " + d.toString()));
    cp.on("exit", (code: number) => {
      console.error(`[supervisor] cupsey-watch exited ${code} — relaunching in 10s`);
      setTimeout(launchCupsey, 10_000);
    });
  };

  const launchSniper = () => {
    const cp = spawn(process.execPath, [tsx, sniper], {
      cwd: path.join(ROOT, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MEGAPHONE_SNIPER: "1" },
    });
    const tag = `[${new Date().toISOString()}] [sniper] `;
    cp.stdout.on("data", (d: Buffer) => fs.appendFile(SNIPER_LOG, tag + d.toString()));
    cp.stderr.on("data", (d: Buffer) => fs.appendFile(SNIPER_LOG, tag + "[err] " + d.toString()));
    cp.on("exit", (code: number) => {
      console.error(`[supervisor] sniper exited ${code} — relaunching in 10s`);
      setTimeout(launchSniper, 10_000);
    });
  };

  trace("spawning children");
  launch();
  launchCupsey();
  launchSniper();
  trace("children spawned, setting intervals");
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
  trace("all intervals set - start() returning (should stay alive via timers)");

  // heartbeat
  setInterval(() => {
    const t = new Date().toISOString();
    fs.appendFile(LOG, `[${t}] [heartbeat] alive, restarts=${restarts}\n`);
  }, 300_000);
}

start().then(() => trace("start() RESOLVED")).catch((e) => {
  writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".supervisor.fatal.log"), "FATAL " + (e && (e as Error).stack || e));
  console.error("[supervisor] fatal", e);
  process.exit(1);
});
