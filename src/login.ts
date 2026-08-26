import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { fileURLToPath } from "node:url";
import { promises as fs, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PUMPFUN_TOKEN, FOUNDER_CHAT } from "./config";

const API = "https://frontend-api-v3.pump.fun";
const DATA_DIR = () => process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");

function saveKey(keyB58: string) {
  // persist the wallet secret so future logins don't need re-entry
  mkdirSync(DATA_DIR(), { recursive: true });
  writeFileSync(path.join(DATA_DIR(), "wallet.key"), keyB58, { mode: 0o600 });
}

function loadKey(): string | null {
  try {
    return readFileSync(path.join(DATA_DIR(), "wallet.key"), "utf8").trim();
  } catch {
    return null;
  }
}

/** Generate a brand-new Solana wallet and persist its secret. */
export function generateWallet(): string {
  const kp = Keypair.generate();
  const keyB58 = bs58.encode(kp.secretKey);
  saveKey(keyB58);
  console.log(`[identity] generated wallet ${kp.publicKey.toBase58()}`);
  return keyB58;
}

/** Register a wallet on pump.fun (creates the account if it doesn't exist). */
export async function register(address: string): Promise<boolean> {
  const res = await fetch(`${API}/users/register`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://pump.fun",
    },
    body: JSON.stringify({ address }),
  });
  if (res.ok) {
    console.log(`[identity] registered ${address}`);
    return true;
  }
  // 400/conflict often means already registered — treat as success
  const body = await res.text().catch(() => "");
  if (res.status === 400 || res.status === 409) {
    console.log(`[identity] ${address} already registered (${body.slice(0, 80)})`);
    return true;
  }
  console.error(`[identity] register failed ${res.status}: ${body.slice(0, 120)}`);
  return false;
}

/** Set username/bio for the registered wallet (optional profile polish). */
export async function setupProfile(token: string, username: string, bio: string): Promise<boolean> {
  const res = await fetch(`${API}/users`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://pump.fun",
      Cookie: `auth_token=${token}`,
    },
    body: JSON.stringify({ username, bio }),
  });
  if (res.ok) {
    console.log(`[identity] profile set: @${username}`);
    return true;
  }
  const body = await res.text().catch(() => "");
  console.error(`[identity] profile failed ${res.status}: ${body.slice(0, 120)}`);
  return false;
}

/** Mint a pump.fun JWT by signing a login challenge with the wallet. */
export async function login(walletKeyB58?: string): Promise<string | null> {
  const key = walletKeyB58 ?? process.env.PUMPFUN_WALLET_KEY ?? loadKey();
  if (!key) {
    console.error("[login] no wallet key — run `npm run identity` first or set PUMPFUN_WALLET_KEY");
    return null;
  }
  const wallet = Keypair.fromSecretKey(bs58.decode(key));
  const address = wallet.publicKey.toBase58();

  // register may 401 if pump.fun gates it behind a session now; login may
  // auto-create. Try register but don't block on failure.
  await register(address).catch((e) => console.log(`[identity] register skipped: ${String(e).slice(0,80)}`));

  const timestamp = Date.now();
  const message = `Sign in to pump.fun: ${timestamp}`;
  const msgBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(msgBytes, wallet.secretKey);
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

/** One-shot: generate wallet (if needed) → login → optional profile. */
export async function setupIdentity(username?: string, bio?: string): Promise<string | null> {
  let key = loadKey();
  if (!key) key = generateWallet();
  const wallet = Keypair.fromSecretKey(bs58.decode(key));
  const address = wallet.publicKey.toBase58();
  const token = await login(key);
  if (token && username) {
    await setupProfile(token, username, bio ?? "");
  }
  return token;
}

// run: tsx src/login.ts            -> login with existing key
//      tsx src/login.ts --setup    -> generate (if needed) + login + profile
if (fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith("/src/login.ts")) {
  const arg = process.argv[2];
  const run = arg === "--setup" ? setupIdentity("megaphone_callouts", "Elite pump.fun callouts. Filtered, not first.") : login();
  run
    .then((t) => (t ? process.exit(0) : process.exit(1)))
    .catch((e) => {
      console.error("[login] fatal", e);
      process.exit(1);
    });
}
