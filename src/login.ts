import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { fileURLToPath } from "node:url";
import { PUMPFUN_TOKEN, FOUNDER_CHAT } from "./config";

const API = "https://frontend-api-v3.pump.fun";

/**
 * Mint a pump.fun JWT by signing a login challenge with a Solana wallet.
 * This is EXACTLY what the website does: sign "Sign in to pump.fun: <ts>",
 * POST { address, signature, timestamp } to /auth/login, get the token.
 *
 * No devtools. No screenshots. You give the wallet's base58 secret key
 * (env PUMPFUN_WALLET_KEY) and this produces the session JWT.
 *
 * The token is written to .megaphone/token.json so the daemon picks it up.
 */
export async function login(walletKeyB58?: string): Promise<string | null> {
  const key = walletKeyB58 ?? process.env.PUMPFUN_WALLET_KEY;
  if (!key) {
    console.error("[login] no wallet key — set PUMPFUN_WALLET_KEY (base58 secret)");
    return null;
  }
  const wallet = Keypair.fromSecretKey(bs58.decode(key));
  const address = wallet.publicKey.toBase58();

  const timestamp = Date.now();
  const message = `Sign in to pump.fun: ${timestamp}`;
  const msgBytes = new TextEncoder().encode(message);
  // sign with the ed25519 secret key (first 32 bytes of the 64-byte secret)
  const signature = nacl.sign.detached(msgBytes, wallet.secretKey.slice(0, 32));
  const sigB58 = bs58.encode(signature);

  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://pump.fun",
    },
    body: JSON.stringify({ address, signature: sigB58, timestamp }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[login] failed ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }

  // token may come in body as { token } or in Set-Cookie as auth_token=
  const ct = res.headers.get("content-type") ?? "";
  let token = "";
  if (ct.includes("application/json")) {
    const j = (await res.json()) as { token?: string };
    token = j.token ?? "";
  }
  if (!token) {
    const sc = res.headers.get("set-cookie") ?? "";
    const m = sc.match(/auth_token=([^;]+)/);
    if (m) token = m[1];
  }

  if (!token) {
    console.error("[login] no token in response body or cookies");
    return null;
  }

  // persist for the daemon
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, "token.json"),
    JSON.stringify({ token, address, obtainedAt: Date.now() }, null, 2),
  );
  console.log(`[login] OK — token for ${address} saved to .megaphone/token.json`);
  return token;
}

// run: tsx src/login.ts
if (fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith("/src/login.ts")) {
  login()
    .then((t) => (t ? process.exit(0) : process.exit(1)))
    .catch((e) => {
      console.error("[login] fatal", e);
      process.exit(1);
    });
}
