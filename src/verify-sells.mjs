// verify-sells.mjs — check token accounts for the 3 sold mints
const mints = [
  "HQYDKEMMK1a4xeZp1LRZRd5WXVKaQwRmFm8XwfUBpump",
  "tvnZpeX9mCj1F86yWQwkrTVNBeCp5D9d61RsmRNpump",
  "2u2NhoNztcTR886C7eVeH1rnfjjg1TGhRRgQZPZUpump",
];
const WALLET = "BT7bQZmXqk9ZedacpdWLceEeWemCU6P59zwmBC8bNUUB";
const rpc = "https://api.mainnet-beta.solana.com";
async function main() {
  for (const mint of mints) {
    const body = {
      jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
      params: [WALLET, { mint }, { encoding: "jsonParsed" }],
    };
    try {
      const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      const accounts = j?.result?.value || [];
      let amt = 0;
      for (const a of accounts) amt += parseFloat(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
      console.log(mint.slice(0, 8), "→ balance:", amt);
    } catch (e) { console.log(mint.slice(0, 8), "ERR", e.message); }
  }
}
main();
