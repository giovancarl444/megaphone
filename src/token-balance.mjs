// token-balance.mjs — print on-chain balance of a mint for the founder wallet
const mint = process.argv[2];
const WALLET = "BT7bQZmXqk9ZedacpdWLceEeWemCU6P59zwmBC8bNUUB";
if (!mint) { console.error("usage: node src/token-balance.mjs <mint>"); process.exit(2); }
const rpc = "https://api.mainnet-beta.solana.com";
const body = {
  jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
  params: [WALLET, { mint }, { encoding: "jsonParsed" }],
};
const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const j = await r.json();
let amt = 0;
for (const a of j?.result?.value || []) amt += parseFloat(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
console.log(amt.toFixed(6));
