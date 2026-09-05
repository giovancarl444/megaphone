// debug-mc.mjs — check usd_market_cap vs market_cap ratio on the list feed
const r = await fetch("https://frontend-api-v3.pump.fun/coins?sort=last_trade_timestamp&limit=50&offset=0", {
  headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000),
});
const coins = await r.json();
for (const c of coins.slice(0, 12)) {
  const usd = c.usd_market_cap || 0;
  const raw = c.market_cap || 0;
  console.log(
    String(c.symbol || "?").slice(0, 10).padEnd(10),
    "| usd:", String(Math.round(usd)).padStart(10),
    "| raw:", String(Math.round(raw)).padStart(9),
    "| ratio:", raw ? Math.round(usd / raw) : "-",
    "| complete:", c.complete,
    "| ageMin:", Math.round((Date.now() - (c.created_timestamp || 0)) / 60000),
  );
}
