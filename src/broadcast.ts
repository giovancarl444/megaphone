import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { CALLOUT_CHAT, PROOF_CHAT } from "./config";
import type { Callout } from "./leaderboard";

/**
 * Broadcast a callout to the dedicated Telegram feed channel (CALLOUT_CHAT).
 * Same text we'd post to pump.fun, so we can see, optimize, and confirm
 * quality BEFORE flipping the pump.fun posting switch.
 */

export function formatCallout(c: Callout): string {
  const mult = c.multiple ? `${c.multiple.toFixed(1)}x proven` : "early call";
  const thesis = (c.reasons.find((r) => r.startsWith("thesis:")) ?? "").replace("thesis: ", "");
  const lines = [
    `🔥 CALL $${c.symbol}`,
    `📊 ${mult} · called @ $${Math.round(c.calledMcUsd)}`,
  ];
  if (thesis) lines.push(`💡 "${thesis}"`);
  if (c.sourceHandle) lines.push(`🐋 mirrored from ${c.sourceHandle}`);
  lines.push(`🔗 pump.fun/coin/${c.mint}`);
  return lines.join("\n");
}

export function broadcastCallout(c: Callout): void {
  const text = formatCallout(c);
  try {
    // write to a temp file so real newlines survive (JSON.stringify mangles them)
    const tmp = path.join(os.tmpdir(), `callout-${c.mint.slice(0, 8)}.txt`);
    fsSync.writeFileSync(tmp, text, "utf8");
    execSync(`hermes send -t ${CALLOUT_CHAT} -f "${tmp}"`, { stdio: "ignore" });
    fsSync.unlinkSync(tmp);
    console.log(`[broadcast] sent $${c.symbol} -> ${CALLOUT_CHAT}`);
  } catch (e) {
    console.warn("[broadcast] failed:", (e as Error).message);
  }
}

/** Re-broadcast a batch (used by /broadcast command). */
export function broadcastBatch(calls: Callout[]): number {
  let n = 0;
  for (const c of calls) {
    broadcastCallout(c);
    n++;
  }
  return n;
}
