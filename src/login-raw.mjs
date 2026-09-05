// login-raw.mjs — capture raw login response body + headers to find the token
import bs58 from "bs58";
import nacl from "tweetnacl";

const API = "https://frontend-api-v3.pump.fun";
const WALLET = "6xxWhUvg9szw5BmnmeNbEBd3Rv9hDBcAX6AHLbapLDBa";
const SECRET = "QbHNbsk4CMi3wzXfM8mb8kWkB3D88deXhqP8bL8oELx7Wqew3Zg1vKBLWr3V3zhaEjLH2gUop2JVmZ5gC8hEQKe";

const ts = Date.now();
const msg = new TextEncoder().encode(`Sign in to pump.fun: ${ts}`);
const sig = nacl.sign.detached(msg, bs58.decode(SECRET));

const res = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://pump.fun", "User-Agent": "Mozilla/5.0" },
  body: JSON.stringify({ address: WALLET, signature: bs58.encode(sig), timestamp: ts }),
});
console.log("status:", res.status);
console.log("=== HEADERS ===");
res.headers.forEach((v, k) => console.log(`  ${k}: ${v.slice(0, 120)}`));
console.log("=== BODY ===");
const text = await res.text();
console.log(text.slice(0, 600));
