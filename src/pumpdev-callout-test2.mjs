/**
 * pumpdev-callout-test2.mjs — THE DECISIVE TEST.
 * Login via keypair (token in auth_token cookie) -> eligibility -> callout create.
 */
import bs58 from "bs58";
import nacl from "tweetnacl";

const API = "https://frontend-api-v3.pump.fun";
const WALLET = "6xxWhUvg9szw5BmnmeNbEBd3Rv9hDBcAX6AHLbapLDBa";
const SECRET = "QbHNbsk4CMi3wzXfM8mb8kWkB3D88deXhqP8bL8oELx7Wqew3Zg1vKBLWr3V3zhaEjLH2gUop2JVmZ5gC8hEQKe";
const MINT = "5sbXfMdfn9xrt2bndjkvoiVJM6kA8TtSazmuhYfpump"; // ACF — we hold $1+

async function jfetch(url, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, { ...opts, headers: { "User-Agent": "Mozilla/5.0", ...(opts.headers || {}) } });
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
}

// login
const ts = Date.now();
const msg = new TextEncoder().encode(`Sign in to pump.fun: ${ts}`);
const sig = nacl.sign.detached(msg, bs58.decode(SECRET));
const login = await jfetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://pump.fun" },
  body: JSON.stringify({ address: WALLET, signature: bs58.encode(sig), timestamp: ts }),
});
const setCookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [];
const authCookie = (setCookies.find((c) => c.startsWith("auth_token=")) || "").split(";")[0];
console.log("login:", login.status, "auth_token cookie:", authCookie ? authCookie.slice(0, 40) + "..." : "MISSING");
if (!authCookie) { console.log("NO TOKEN — aborting"); process.exit(1); }
const token = authCookie.replace("auth_token=", "");

// eligibility
const elig = await jfetch(`${API}/callout/eligibility/${MINT}`, {
  headers: { Authorization: `Bearer ${token}`, Cookie: authCookie },
});
console.log("eligibility:", elig.status, (await elig.text()).slice(0, 300));

// THE TEST — callout create
const post = await jfetch(`${API}/callout/create`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    Cookie: authCookie,
    Origin: "https://pump.fun",
  },
  body: JSON.stringify({ coinMint: MINT, thesis: "ACF EARLY", version: 2 }),
});
console.log("CALLOUT POST:", post.status, (await post.text()).slice(0, 400));
