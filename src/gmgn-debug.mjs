// gmgn-debug.mjs — why are candidates scoring 0? Show field values vs thresholds.
import { execSync } from "node:child_process";

function gmgnTrending(interval, minMc, maxMc) {
  const cmd = `gmgn-cli market trending --chain sol --interval ${interval} --limit 20 --platform "Pump.fun" --min-marketcap ${minMc} --max-marketcap ${maxMc} --order-by volume --direction desc --raw`;
  try {
    return JSON.parse(execSync(cmd, { encoding: "utf8", timeout: 40000, windowsHide: true }))?.data?.rank || [];
  } catch (e) { console.log("err", e.message.slice(0, 80)); return []; }
}

const now = Date.now();
const micro = gmgnTrending("1m", 3000, 150000);
console.log("=== MICRO (first 8) ===");
for (const t of micro.slice(0, 8)) {
  const ageMin = (now - (t.creation_timestamp || now)) / 60000;
  console.log(
    `${(t.symbol || "?").slice(0, 12)} | mc $${(t.market_cap || 0).toFixed(0)} | ${ageMin.toFixed(0)}m | b:${t.buys} s:${t.sells} | 1m:${(t.price_change_percent1m || 0).toFixed(1)}% 5m:${(t.price_change_percent5m || 0).toFixed(1)}% 1h:${(t.price_change_percent1h || 0).toFixed(1)}% | swaps:${t.swaps} | holders:${t.holder_count} | renounced:${t.renounced_mint}`
  );
}
const liquid = gmgnTrending("1h", 5000000, 100000000);
console.log("=== LIQUID (first 8) ===");
for (const t of liquid.slice(0, 8)) {
  console.log(
    `${(t.symbol || "?").slice(0, 12)} | mc $${(t.market_cap || 0).toFixed(0)} | b:${t.buys} s:${t.sells} | 1h:${(t.price_change_percent1h || 0).toFixed(1)}% | vol $${(t.volume || 0).toFixed(0)} | holders:${t.holder_count} | rug:${((t.rug_ratio || 0) * 100).toFixed(0)}%`
  );
}
