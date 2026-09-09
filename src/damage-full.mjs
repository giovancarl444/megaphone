// damage-full.mjs — check every coin the engine ever touched, both token programs
const WALLET = "BT7bQZmXqk9ZedacpdWLceEeWemCU6P59zwmBC8bNUUB";
const rpc = "https://api.mainnet-beta.solana.com";
import { readFileSync } from "node:fs";
async function bal(mint) {
  const body = { jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [WALLET, { mint }, { encoding: "jsonParsed" }] };
  try {
    const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    let amt = 0;
    for (const a of j?.result?.value || []) amt += parseFloat(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
    return amt;
  } catch { return null; }
}
async function main() {
  const ledger = JSON.parse(readFileSync("D:\\megaphone\\.megaphone\\gmgn-calls.json", "utf8"));
  let held = 0, sumUsd = 0;
  for (const c of ledger) {
    const amt = await bal(c.mint);
    if (amt && amt > 0) {
      held++;
      console.log("HELD:", c.symbol, c.mint.slice(0, 8), amt.toFixed(2));
    }
  }
  console.log("positions held:", held, "of", ledger.length, "ledger entries");
}
main();
