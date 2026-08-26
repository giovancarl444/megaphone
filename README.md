# MEGAPHONE

Pump.fun **callout engine** — watches the live token firehose, scores new
launches for "worth calling", and pushes high-conviction alerts to Telegram.

Goal (per founder): become the most-followed coin-callout account on pump.fun.
Follower growth is a *derivative* of visible win-rate — so the engine optimizes
for **selective, high-conviction calls**, not volume.

## How it works

```
pump.fun REST firehose (coins?sort=created_timestamp)
        │  every 4s
        ▼
   scoreCoin()  ── real SOL behind it? + socials? + early? ──► pass/fail
        │  pass
        ▼
   hermes send --to telegram:1915394365  "📣 CALL — $SYMBOL ..."
```

The leaderboard ranks verified call accuracy tied to one identity. So this
ships as a **single account** — multi-accounting would split the track record
and kill the compounding flywheel.

## Commands

```bash
npm install
npm run scan      # one-shot: score newest 50 coins (tune the filter)
npm run watch     # live: poll every 4s, alert passing coins to Telegram
npm run resolve <mint> [calledMcUsd]   # check a called coin's outcome (multi-x)
```

## Tuning

All gates live in `src/config.ts`:
- `minRealSol` — min real SOL deposited in the bonding curve (anti-dust)
- `minSocials` / `requireSocials` — legitimacy floor
- `minMcUsd` / `maxMcUsd` — market-cap band
- `alertThreshold` — score to fire

## Note on the live WebSocket

pumpdev.io offers a free WebSocket firehose, but keyless connections are
limited to **1 per IP** and this box is currently rate-limited. The REST
poller (`src/watch.ts` REST mode) is the active path — no key, unthrottled.
Swap to `subscribeNewToken` WS once a free pumpdev API key is added.

## Track record (the compounding asset)

Every alert you act on should be logged. Run `npm run resolve <mint> <calledMc>`
later to record the multiple. Over time this mirrors what the pump.fun
callouts leaderboard computes — and that leaderboard is what markets you.
