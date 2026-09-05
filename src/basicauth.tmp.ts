import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { readFileSync } from "node:fs";

const keyB58 = readFileSync(".megaphone/wallet.key", "utf8").trim();
const kp = Keypair.fromSecretKey(bs58.decode(keyB58));
const ts = Math.floor(Date.now() / 1000);
const msg = `Sign in to pump.fun: ${ts}`;
const sig = nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey);
const sigB64 = Buffer.from(sig).toString("base64");
console.log(JSON.stringify({ address: kp.publicKey.toBase58(), ts, msg, sigB64 }));
