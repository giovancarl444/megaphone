/**
 * token-safety.ts — FREE callout protection gate.
 *
 * Runs a GoPlus Solana token_security scan (no API key, free) on a mint and
 * produces a verdict: PASS / WARN / DANGER. Used before ANY callout posts so
 * we never risk our reputation on a rug/honeypot/printable token.
 *
 * Usage:
 *   tsx src/token-safety.ts <mint>          -> single scan
 *   tsx src/token-safety.ts --queue         -> scan all QUEUED/READY callouts in callout-queue.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const GOPLUS_SOL = "https://api.gopluslabs.io/api/v1/solana/token_security";

export interface SafetyVerdict {
  mint: string;
  score: number;            // 0-100, 100 = safest
  verdict: "PASS" | "WARN" | "DANGER";
  flags: string[];
  checks: Record<string, any>;
}

export async function scanMint(mint: string): Promise<SafetyVerdict> {
  const url = `${GOPLUS_SOL}?contract_addresses=${mint}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
  const j: any = await res.json();
  const tok = j?.result?.[mint] ?? j?.result?.[Object.keys(j?.result || {})[0]];
  if (!tok) return { mint, score: 0, verdict: "DANGER", flags: ["NO_DATA"], checks: {} };

  const flags: string[] = [];
  let score = 100;

  // mint authority = creator can print unlimited supply (worst flag)
  const mintable = tok.mintable?.status === "1";
  if (mintable) { flags.push("MINTABLE (creator can print)"); score -= 40; }
  // freeze authority
  const freezable = tok.freezable?.status === "1";
  if (freezable) { flags.push("FREEZABLE"); score -= 20; }
  // closable
  const closable = tok.closable?.status === "1";
  if (closable) { flags.push("CLOSABLE"); score -= 15; }
  // metadata mutable (rug rebrand risk)
  const metaMutable = tok.metadata_mutable?.status === "1";
  if (metaMutable) { flags.push("MUTABLE METADATA"); score -= 5; }
  // transfer hook = potential honeypot mechanism
  const hook = tok.transfer_hook?.status === "1";
  if (hook) { flags.push("TRANSFER HOOK"); score -= 20; }
  // non-transferable
  const nonTransfer = tok.non_transferable?.status === "1";
  if (nonTransfer) { flags.push("NON-TRANSFERABLE"); score -= 25; }
  // holder concentration
  const topPct = Number(tok.top_10_holder_pct ?? 0);
  if (topPct > 55) { flags.push(`TOP10 HOLDERS ${topPct.toFixed(0)}%`); score -= 15; }
  // trusted token list
  if (tok.trusted_token === "1") score += 10;

  const verdict: SafetyVerdict["verdict"] = score >= 80 ? "PASS" : score >= 50 ? "WARN" : "DANGER";
  return {
    mint,
    score: Math.max(0, Math.min(100, score)),
    verdict,
    flags,
    checks: { mintable, freezable, closable, metaMutable, hook, nonTransfer, topPct: Math.round(topPct) },
  };
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--queue") {
    const qf = path.join(process.cwd(), ".megaphone", "callout-queue.json");
    let q: any[] = [];
    try { q = JSON.parse(readFileSync(qf, "utf8")); } catch { console.error("no queue file"); process.exit(1); }
    let changed = false;
    for (const c of q) {
      if (c.status === "POSTED" || c.safety) continue;
      const v = await scanMint(c.mint);
      c.safety = v;
      c.status = v.verdict === "DANGER" ? "SKIPPED" : c.status; // dangerous callouts auto-skip
      console.log(`${v.verdict.padEnd(6)} ${c.mint.slice(0, 10)}… score ${v.score} ${v.flags.join(", ")}`);
      changed = true;
    }
    if (changed) writeFileSync(qf, JSON.stringify(q, null, 2));
    console.log("queue scan done");
    return;
  }
  if (!arg) { console.error("usage: tsx src/token-safety.ts <mint> | --queue"); process.exit(1); }
  const v = await scanMint(arg);
  console.log(`${v.verdict} | score ${v.score} | ${v.flags.join(", ") || "clean"}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() || "");
if (isMain) main();
