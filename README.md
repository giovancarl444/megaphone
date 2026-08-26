# MEGAPHONE

Pump.fun **callout engine** — the signal half of a signal→execution→proof
loop with **SVEE** (the trading terminal). Watches the live token firehose,
scores new launches for "worth calling", logs them to a shared ledger, and
proves the winners by posting outcomes. Goal: become the most-followed
coin-callout account on pump.fun — follower growth is a *derivative of visible
win-rate*, so the engine optimizes for **selective, high-conviction calls**.

## How it fits with SVEE

```
MEGAPHONE (signal)                 SVEE (proof + execution)
───────────────────                ──────────────────────────
pump.fun REST firehose             GET /api/callouts reads the SAME ledger
  ↓ scoreCoin (real SOL + socials)     ↓
  ↓ log to .megaphone/callouts.json    Callouts view: track record + one-click Trade
  ↓ alert to Telegram                  ↓
resolve-loop: resolve aged calls       you execute as paper trade → resolve → multiple
  ↓ broadcast proof (≥1.5x wins)        ↓
followers grow from verified record     win-rate/avg-multiple = leaderboard metric
```

Both repos are independent but share the ledger file at
`D:\megaphone\.megaphone\callouts.json` (gitignored). SVEE points at it via
`MEGAPHONE_DIR` (defaults to `../megaphone`).

## Commands

```bash
npm install
npm run scan       # one-shot: score newest 50 coins (tune the filter)
npm run watch      # live: poll every 4s, alert passing coins + log to ledger
npm run mirror     # whale-mirror: cupsy + orangey calls through our filter
npm run resolve    # one sweep: resolve aged calls + broadcast proof
npm run daemon     # watch + resolve-loop together, forever
```

## Architecture

- **`score.ts`** — `scoreCoin()`: real SOL in bonding curve + ≥2 socials +
  early age. Anti-dust, anti-spam.
- **`watch.ts`** — REST firehose poller (no key, unthrottled). Logs every pass
  to the ledger + alerts Telegram.
- **`leaderboard.ts`** — shared callouts ledger + track-record aggregate
  (win-rate, avg/best multiple). The proof asset.
- **`resolve-loop.ts`** — resolves calls older than 45m, broadcasts proof for
  ≥1.5x wins to Telegram (+ pump.fun reply if `PROOF_CALL_REPLY_TOKEN` set).
- **`daemon.ts`** — runs watch + resolve-loop together, persistent.
- **`whales.ts`** — whale-mirror source (needs `PUMPFUN_TOKEN` for call reads).

## Tuning

All gates in `src/config.ts`: `minRealSol`, `minSocials`, `minMcUsd`/
`maxMcUsd`, `alertThreshold`, `WHALES[]` (add callers by resolving their wallet
via `GET /users/<handle>`).

## Note on the live WebSocket

pumpdev.io free WS is keyless-1-per-IP and this box is rate-limited. REST
poller is the active path. Swap to WS once a free pumpdev key is added.

## Persistence

Daemon runs detached (background). For login-persistence, create a scheduled
task pointing at `MEGAPHONE_DAEMON.bat` (admin). Gateway-style auto-start.
