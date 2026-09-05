/**
 * api-rail.ts — PURE-API pump.fun rail (no browser, no CDP, no Privy).
 *
 * Proven 09-05 on the pumpdev wallet (identity "DuneFewRoar"):
 *   buy via pumpdev REST -> pump.fun indexes holding (~10s) -> keypair login
 *   (JWT in auth_token SET-COOKIE) -> eligibility -> POST /callout/create = 201.
 *
 * Pitfalls encoded here:
 *   - pumpdev secret is BASE58 (64B), not base64.
 *   - pumpdev returns a signature that sometimes NEVER lands -> always verify
 *     on-chain via getSignatureStatuses and retry the buy.
 *   - pump.fun login JWT rides in the auth_token cookie, not the JSON body.
 *   - eligibility indexes holdings with lag (~10-15s after buy finalizes).
 *   - gate = >= $1 USD of the SPECIFIC coin held by the login wallet.
 */
import bs58 from "bs58";
import nacl from "tweetnacl";

const PUMPDEV_API = "https://pumpdev.io";
const PF_API = "https://frontend-api-v3.pump.fun";
const RPC = "https://solana-rpc.publicnode.com";

const PUMPDEV_API_KEY = process.env.PUMPDEV_API_KEY || "";
const PUMPDEV_SECRET = process.env.PUMPDEV_PRIVATE_KEY || ""; // base58 64B
const PUMPDEV_WALLET = process.env.PUMPDEV_PUBLIC_KEY || "";

function cfgOk(): boolean {
  return !!(PUMPDEV_API_KEY && PUMPDEV_SECRET && PUMPDEV_WALLET);
}

async function jfetch(url: string, opts: any = {}, tries = 4): Promise<Response> {
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, {
        ...opts,
        headers: { "User-Agent": "Mozilla/5.0", ...(opts.headers || {}) },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

async function rpc(method: string, params: any[]): Promise<any> {
  const r = await jfetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

/** Verify a Solana signature actually landed (finalized, no error). */
async function sigConfirmed(sig: string): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await rpc("getSignatureStatuses", [[sig]]);
      const v = (res?.value || [])[0];
      if (v?.err == null && v?.confirmationStatus === "finalized") return true;
      if (v?.err) return false;
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

/** Buy a coin via pumpdev REST. Verifies the tx lands; retries once if ghosted. */
export async function apiBuy(mint: string, solAmount: number): Promise<string | null> {
  if (!cfgOk()) throw new Error("api-rail: PUMPDEV env keys missing");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await jfetch(`${PUMPDEV_API}/api/trade-lightning?api-key=${PUMPDEV_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "buy", mint, amount: solAmount, denominatedInSol: "true", slippage: 25 }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!j.signature) { console.log(`[api-rail] buy resp no sig: ${JSON.stringify(j).slice(0, 120)}`); return null; }
      if (await sigConfirmed(j.signature)) return j.signature;
      console.log(`[api-rail] sig ${j.signature.slice(0, 8)}… never landed (attempt ${attempt + 1}) — retrying buy`);
    } catch (e) {
      console.log(`[api-rail] buy err: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  return null;
}

/** Sell a coin via pumpdev REST (all or specific amount). */
export async function apiSell(mint: string, solAmount?: number): Promise<string | null> {
  if (!cfgOk()) throw new Error("api-rail: PUMPDEV env keys missing");
  try {
    const body: any = { action: "sell", mint, slippage: 25 };
    if (solAmount) { body.amount = solAmount; body.denominatedInSol = "true"; }
    const r = await jfetch(`${PUMPDEV_API}/api/trade-lightning?api-key=${PUMPDEV_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!j.signature) return null;
    return (await sigConfirmed(j.signature)) ? j.signature : null;
  } catch { return null; }
}

/** Keypair login to pump.fun. Returns the auth_token (from set-cookie). */
export async function apiLogin(): Promise<string | null> {
  const ts = Date.now();
  const msg = new TextEncoder().encode(`Sign in to pump.fun: ${ts}`);
  const sig = nacl.sign.detached(msg, bs58.decode(PUMPDEV_SECRET));
  const r = await jfetch(`${PF_API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://pump.fun" },
    body: JSON.stringify({ address: PUMPDEV_WALLET, signature: bs58.encode(sig), timestamp: ts }),
  });
  if (!r.ok) return null;
  const cookies = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
  const auth = (cookies.find((c: string) => c.startsWith("auth_token=")) || "").split(";")[0];
  return auth.replace("auth_token=", "") || null;
}

/** Check eligibility preflight for a mint (needs fresh token). */
export async function apiEligibility(mint: string, token: string): Promise<any> {
  const r = await jfetch(`${PF_API}/callout/eligibility/${mint}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: "https://pump.fun" },
  });
  return await r.json().catch(() => ({}));
}

/**
 * Full callout pipeline: login -> (optional wait for index) -> eligibility ->
 * create. Returns {ok, verdict?, calloutId?}.
 */
export async function apiPostCallout(mint: string, thesis: string, opts: { waitMs?: number } = {}): Promise<{ ok: boolean; detail: string }> {
  if (!cfgOk()) throw new Error("api-rail: PUMPDEV env keys missing");
  const token = await apiLogin();
  if (!token) return { ok: false, detail: "login failed" };

  if (opts.waitMs) await new Promise((r) => setTimeout(r, opts.waitMs!));

  const elig = await apiEligibility(mint, token);
  const verdict = elig?.preflight?.create?.verdict || elig?.eligible === false ? "NOT_ELIGIBLE" : "?";
  const createOk = elig?.preflight?.create?.verdict === "ELIGIBLE";
  if (!createOk) {
    return { ok: false, detail: `eligibility: ${elig?.preflight?.create?.verdict || JSON.stringify(elig).slice(0, 120)}` };
  }

  const r = await jfetch(`${PF_API}/callout/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "https://pump.fun",
    },
    body: JSON.stringify({ coinMint: mint, thesis, version: 2 }),
  });
  const body = await r.text();
  if (r.status === 201) {
    try { return { ok: true, detail: JSON.parse(body)?.callout?.calloutId || "posted" }; }
    catch { return { ok: true, detail: "posted" }; }
  }
  return { ok: false, detail: `HTTP ${r.status}: ${body.slice(0, 150)}` };
}

/** SOL balance of the pumpdev wallet. */
export async function apiSolBalance(): Promise<number> {
  try {
    const res = await rpc("getBalance", [PUMPDEV_WALLET]);
    return (res?.value || 0) / 1e9;
  } catch { return 0; }
}
