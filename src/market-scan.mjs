// market-scan.mjs — what does the real market look like right now? calibrate filters
import { execSync } from "node:child_process";

function scan(interval, minMc, maxMc) {
  const cmd = `gmgn-cli market trending --chain sol --interval ${interval} --limit 30 --platform "Pump.fun" --min-marketcap ${minMc} --max-marketcap ${maxMc} --order-by volume --direction desc --raw`;
  try {
    return JSON.parse(execSync(cmd, { encoding: "utf8", timeout: 40000, windowsHide: true }))?.data?.rank || [];
  } catch (e) { console.log("err", e.message.slice(0, 60)); return []; }
}

const now = Date.now();
console.log("=== MICRO 3K-60K (top by volume) ===");
for (const t of scan("1m", 3000, 60000).slice(0, 15)) {
  const ageMin = Math.round((now - (t.creation_timestamp || now / 1000) * 1000) / 60000);
  const ratio = t.sells > 0 ? (t.buys / t.sells).toFixed(1) : "∞";
  console.log(`${(t.symbol || "?").slice(0, 12).padEnd(12)} | $${Math.round(t.market_cap || 0).toLocaleString().padStart(8)} | ${String(ageMin).padStart(4)}m | b:${t.buys} s:${t.sells} (${ratio}) | bundler:${((t.bundler_rate || 0) * 100).toFixed(0)}% | bots:${((t.bot_degen_rate || 0) * 100).toFixed(0)}% | devClose:${t.creator_close} | 1h:${(t.price_change_percent1h || 0).toFixed(0)}%`);
}
