// damage-report.mjs — what token balances does the wallet actually hold?
const WALLET = "BT7bQZmXqk9ZedacpdWLceEeWemCU6P59zwmBC8bNUUB";
const rpc = "https://api.mainnet-beta.solana.com";
async function main() {
  const body = {
    jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
    params: [WALLET, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }],
  };
  const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  const accounts = j?.result?.value || [];
  let total = 0;
  for (const a of accounts) {
    const info = a.account?.data?.parsed?.info;
    const amt = parseFloat(info?.tokenAmount?.uiAmount || 0);
    if (amt > 0) {
      const mint = info?.mint || "?";
      total += amt;
      console.log(mint.slice(0, 12), "→", amt.toFixed(2));
    }
  }
  console.log("token accounts with balance:", total > 0 ? "see above" : "NONE");
}
main().catch((e) => { console.error("ERR", e.message); });
