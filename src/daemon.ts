import { fileURLToPath } from "node:url";
import { resolveLoop } from "./resolve-loop";

const WATCH_POLL_MS = 4_000;
const RESOLVE_EVERY_MS = 60_000; // sweep for resolutions + proofs every 60s

/**
 * MEGAPHONE daemon: runs the firehose watcher (signal generation) and the
 * resolve loop (proof engine) together, forever. The firehose watcher runs
 * on its own 4s interval inside watch.ts; here we just drive the resolve loop
 * on a slower cadence so calls get resolved + proven without manual work.
 */
async function main() {
  console.log("MEGAPHONE daemon starting — firehose + resolve loop");
  // start the firehose watcher as a long-lived process
  const { spawn } = await import("node:child_process");
  const watchProc = spawn(
    process.execPath,
    [fileURLToPath(new URL("./watch.ts", import.meta.url))],
    { stdio: "inherit", env: process.env },
  );
  watchProc.on("exit", (code) =>
    console.error(`[daemon] watch exited ${code}, restarting in 5s`),
  );
  // (restart handled by outer loop below)

  // resolve loop on a timer
  const tick = async () => {
    try {
      await resolveLoop();
    } catch (e) {
      console.error("[daemon] resolve-loop error:", (e as Error).message);
    }
  };
  await tick();
  setInterval(tick, RESOLVE_EVERY_MS);
}

if (fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith("/src/daemon.ts")) {
  main().catch((e) => {
    console.error("[daemon] fatal", e);
    process.exit(1);
  });
}
