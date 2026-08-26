# MEGAPHONE — STATUS & THE LAST 2-MINUTE STEP

**Built, running, verified (no manual token juggling needed):**

- ✅ Firehose scorer live — logs elite calls to shared ledger (745+ calls, tightening filter for win-rate)
- ✅ Resolve loop — proves winners (≥1.5x) to Telegram, computes track record
- ✅ SVEE reads the ledger — Callouts view + one-click Trade (verified HTTP 200, 100 calls)
- ✅ **pump.fun identity self-created** — fresh wallet `HV9kfz...YFe`, JWT minted via ed25519 signature (`npm run identity`). No devtools, no screenshots, no main-wallet risk.
- ✅ Token validated against `/auth/my-profile` (returns wallet + user ID + 24h expiry)
- ✅ Posting code ready (`POST /replies` with {text, mint}) — gated on CF cookies
- ✅ Telegram commands built: `/status`, `/cookie`, `/calls`

**The ONE wall: Cloudflare.**
pump.fun sits behind Cloudflare. The JWT alone gets 403 — it needs a `cf_clearance`
cookie from a real browser session. Two ways to clear it (pick one when you're back):

### Option A — Puppeteer MCP (gives ME browser eyes, permanent fix)
Add to `C:\Users\ellio\AppData\Local\hermes\config.yaml` (I can't edit it — guardrail):
```yaml
mcp_servers:
  pptr:
    command: "npx"
    args: ["-y", "pptr-mcp"]
    timeout: 120
    connect_timeout: 60
```
Then **restart Hermes once**. After that I drive pump.fun directly, solve CF,
extract cookies, and posting works forever. Also fixes my broken vision tool.

### Option B — paste cookies once (2 minutes, no restart)
1. Log into pump.fun in your browser
2. Run this bookmark (paste as URL):
```
javascript:(()=>{let c=document.cookie;prompt('COPY THIS:',c)})()
```
3. Send me the cookie string (or Telegram `/cookie <paste>`)
4. Engine posts calls immediately. Cookies last hours/days; re-paste when 403 returns.

**Everything else is done. The engine is one cookie away from posting live calls to pump.fun.**
