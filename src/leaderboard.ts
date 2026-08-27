/**
 * Shared callouts ledger — the single source of truth that ties MEGAPHONE
 * (signal generation) to SVEE (execution + proof).
 *
 * Every call MEGAPHONE scores is logged here with: mint, symbol, call-time
 * market cap, the filter score, and the source (firehose vs whale-mirror).
 * Later, `resolve` records the outcome multiple — that's the track record
 * that drives followers on pump.fun (verified call accuracy = the leaderboard).
 *
 * Stored as a local JSON file (gitignored) so both processes can read/write
 * without a DB. Swap for Supabase later (same shape).
 */

import { promises as fs } from "fs";
import path from "path";

export interface Callout {
  mint: string;
  symbol: string;
  name?: string;
  source: "firehose" | "whale-mirror";
  sourceHandle?: string; // whale handle if mirrored
  calledAt: number; // ms epoch
  calledMcUsd: number;
  score: number;
  reasons: string[];
  socials: string[];
  // --- call-time predictive features (for learning) ---
  calledRealSol?: number; // bonding-curve SOL at call time
  calledAgeSec?: number; // coin age at call time
  v1?: boolean; // was it on v1 (older) vs v2 firehose
  // --- outcome (filled by resolve) ---
  resolvedAt?: number;
  resolvedMcUsd?: number;
  multiple?: number; // resolvedMcUsd / calledMcUsd
  graduated?: boolean;
  proofPosted?: boolean; // already broadcast as proof
  notes?: string;
}

const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
const LEDGER = path.join(DATA_DIR, "callouts.json");

async function load(): Promise<Callout[]> {
  try {
    return JSON.parse(await fs.readFile(LEDGER, "utf8")) as Callout[];
  } catch {
    return [];
  }
}

// Serialize all ledger writes (Windows: concurrent rename over an open file fails)
let writeChain: Promise<void> = Promise.resolve();
async function save(all: Callout[]): Promise<void> {
  const run = async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = LEDGER + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(all, null, 2));
    // Windows-safe swap: retry rename a few times (file may be briefly locked)
    for (let i = 0; i < 5; i++) {
      try {
        await fs.rename(tmp, LEDGER);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    // fallback: direct overwrite (atomicity lost but write succeeds)
    await fs.writeFile(LEDGER, JSON.stringify(all, null, 2));
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

/** Record a new callout (dedupes by mint). Returns the stored entry. */
export async function logCallout(c: Omit<Callout, "calledAt"> & { calledAt?: number }): Promise<Callout> {
  const all = await load();
  const existing = all.find((x) => x.mint === c.mint);
  if (existing) return existing;
  const entry: Callout = { ...c, calledAt: c.calledAt ?? Date.now() };
  all.unshift(entry);
  // keep whale-mirror calls forever; cap firehose noise at 500
  const mirrors = all.filter((x) => x.source === "whale-mirror");
  const firehose = all.filter((x) => x.source === "firehose").slice(0, 500);
  await save([...mirrors, ...firehose]);
  return entry;
}

/** Update an existing callout entry in place (by mint). */
export async function updateCallout(
  mint: string,
  patch: Partial<Callout>,
): Promise<void> {
  const all = await load();
  const idx = all.findIndex((x) => x.mint === mint);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch };
  await save(all);
}

/** Resolve a call's outcome (called later to build the track record). */
export async function resolveCallout(
  mint: string,
  outcome: { resolvedMcUsd: number; graduated?: boolean; notes?: string },
): Promise<Callout | null> {
  const all = await load();
  const c = all.find((x) => x.mint === mint);
  if (!c) return null;
  c.resolvedAt = Date.now();
  c.resolvedMcUsd = outcome.resolvedMcUsd;
  c.multiple = outcome.resolvedMcUsd / Math.max(1, c.calledMcUsd);
  c.graduated = outcome.graduated;
  c.notes = outcome.notes;
  await save(all);
  return c;
}

/** Aggregate track record — what the pump.fun leaderboard computes. */
export interface TrackRecord {
  total: number;
  resolved: number;
  wins: number; // multiple >= 1.5
  losses: number; // multiple < 1
  avgMultiple: number;
  bestMultiple: number;
  winRate: number; // wins / resolved
}

export async function getTrackRecord(): Promise<TrackRecord> {
  const all = await load();
  const resolved = all.filter((c) => c.multiple !== undefined);
  const wins = resolved.filter((c) => (c.multiple ?? 0) >= 1.5).length;
  const losses = resolved.filter((c) => (c.multiple ?? 0) < 1).length;
  const multiples = resolved.map((c) => c.multiple ?? 0);
  const avg = multiples.length ? multiples.reduce((a, b) => a + b, 0) / multiples.length : 0;
  const best = multiples.length ? Math.max(...multiples) : 0;
  return {
    total: all.length,
    resolved: resolved.length,
    wins,
    losses,
    avgMultiple: avg,
    bestMultiple: best,
    winRate: resolved.length ? wins / resolved.length : 0,
  };
}

export async function recentCallouts(limit = 50): Promise<Callout[]> {
  const all = await load();
  return all.slice(0, limit);
}
