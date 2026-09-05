/**
 * pumpdev-callout-test.mjs — THE ARCHITECTURE-DECIDING EXPERIMENT.
 *
 * Q: Can a raw keypair wallet (pumpdev) log into pump.fun and post a callout
 *    via pure API — no browser, no Privy?
 *
 * The wallet 6xxWhUvg... holds 210,100 ACF tokens (>$1) from the verified buy.
 * If POST /callout/create succeeds -> Rail B is fully browserless. If it fails
 * with the Privy/CF wall -> callouts stay browser-bound.
 */
import bs58 from "bs58";
import nacl from "tweetnacl";
const API = "https://frontend-api-v3.pump.fun";
const WALLET = "6xxWhUvg9szw5BmnmeNbEBd3Rv9hDBcAX6AHLbapLDBa";
const SECRET = "QbHNbsk4CMi3wzXfM8mb8kWkB3D88deXhqP8bL8oELx7Wqew3Zg1vKBLWr3V3zhaEjLH2gUop2JVmZ5gC8hEQKe"; // pumpdev private key
const MINT = "5sbXfMdfn9xrt2bndjkvoiVJM6kA8TtSazmuhYfpump"; // ACF — we hold $1+

async function jfetch(url, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { "User-Agent": "Mozilla/5.0", ...(opts.headers || {}) } });
      return r;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
}

async function main() {
  // 1) register the wallet (idempotent)
  const reg = await jfetch(`${API}/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://pump.fun" },
    body: JSON.stringify({ address: WALLET }),
  });
  console.log("register:", reg.status, (await reg.text()).slice(0, 120));

  // 2) login: sign timestamp (pumpdev secret is base58-encoded 64B key)
  const ts = Date.now();
  const msg = new TextEncoder().encode(`Sign in to pump.fun: ${ts}`);
  const secretBytes = bs58.decode(SECRET);
  const sig = nacl.sign.detached(msg, secretBytes);
  const login = await jfetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://pump.fun" },
    body: JSON.stringify({
      address: WALLET,
      signature: bs58.encode(sig),
      timestamp: ts,
    }),
  });
  const loginBody = await login.json().catch(() => ({}));
  console.log("login:", login.status, "token?", !!loginBody.token);
  if (!loginBody.token) { console.log("LOGIN FAILED:", JSON.stringify(loginBody).slice(0, 200)); return; }
  const token = loginBody.token;

  // 3) check eligibility for ACF
  const elig = await jfetch(`${API}/callout/eligibility/${MINT}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const eligBody = await elig.json().catch(() => ({}));
  console.log("eligibility:", elig.status, JSON.stringify(eligBody).slice(0, 200));

  // 4) THE TEST: post a callout for ACF
  const post = await jfetch(`${API}/callout/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "https://pump.fun",
    },
    body: JSON.stringify({
      coinMint: MINT,
      thesis: "ACF EARLY",
      version: 2,
    }),
  });
  const postBody = await post.text();
  console.log("CALLOUT POST:", post.status, postBody.slice(0, 300));
}

main().catch((e) => console.error("ERR", e));
