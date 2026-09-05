// elig-full.mjs — dump the COMPLETE eligibility preflight JSON
import bs58 from "bs58";
import nacl from "tweetnacl";
const API = "https://frontend-api-v3.pump.fun";
const WALLET = "6xxWhUvg9szw5BmnmeNbEBd3Rv9hDBcAX6AHLbapLDBa";
const SECRET = "QbHNbsk4CMi3wzXfM8mb8kWkB3D88deXhqP8bL8oELx7Wqew3Zg1vKBLWr3V3zhaEjLH2gUop2JVmZ5gC8hEQKe";
const MINT = "5sbXfMdfn9xrt2bndjkvoiVJM6kA8TtSazmuhYfpump";

const ts = Date.now();
const msg = new TextEncoder().encode(`Sign in to pump.fun: ${ts}`);
const sig = nacl.sign.detached(msg, bs58.decode(SECRET));
const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://pump.fun" },
  body: JSON.stringify({ address: WALLET, signature: bs58.encode(sig), timestamp: ts }),
});
const authCookie = (login.headers.getSetCookie().find((c) => c.startsWith("auth_token=")) || "").split(";")[0];
const token = authCookie.replace("auth_token=", "");
console.log("login ok, token len:", token.length);

const elig = await fetch(`${API}/callout/eligibility/${MINT}`, {
  headers: { Authorization: `Bearer ${token}`, Cookie: authCookie, Origin: "https://pump.fun" },
});
const body = await elig.json();
console.log("=== FULL ELIGIBILITY ===");
console.log(JSON.stringify(body, null, 2).slice(0, 2500));
