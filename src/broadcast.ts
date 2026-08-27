import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { FOUNDER_CHAT, PROOF_CHAT } from "./config";
import type { Callout } from "./leaderboard";

/**
 * Broadcast a callout to Telegram in pump.fun-ready format.
 * This is the review feed: same text we'd post to pump.fun, so we can see,
 * optimize, and confirm quality BEFORE flipping the pump.fun posting switch.
 *
 * Destination: CALLOUT_CHAT env (a channel/group id) if set, else founder DM.
 * Set CALLOUT_CHAT to a Telegram channel id (e.g. telegram:-1001234567890)
 * to split the feed from your DMs.
 */
function calloutChat(): string {
  return process.env.CALLOUT_CHAT ?? FOUNDER_CHAT;
}

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
    execSync(`hermes send -t ${calloutChat()} -f "${tmp}"`, { stdio: "ignore" });
    fsSync.unlinkSync(tmp);
    console.log(`[broadcast] sent $${c.symbol} -> ${calloutChat()}`);
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
