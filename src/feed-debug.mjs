// feed-debug.mjs — inspect the live feed and why candidates may be zero
const r = await fetch("https://frontend-api-v3.pump.fun/coins?sort=last_trade_timestamp&limit=50&offset=0", {
  headers: { "User-Agent": "Mozilla/5.0" },
  signal: AbortSignal.timeout(15000),
});
const coins = await r.json();
console.log("feed coins:", coins.length);
const now = Date.now();
for (const c of coins.slice(0, 8)) {
  const ageMin = (now - c.created_timestamp) / 60000;
  const lastTradeS = (now - c.last_trade_timestamp) / 1000;
  console.log(
    `${(c.symbol || "?").slice(0, 10)} | age ${ageMin.toFixed(0)}m | usd_mc $${(c.usd_market_cap || 0).toFixed(0)} | complete ${c.complete} | banned ${c.is_banned} | trade ${lastTradeS.toFixed(0)}s ago | replies ${c.reply_count || 0}`
  );
}
