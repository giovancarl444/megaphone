/**
 * callout-poster.ts — post callouts to pump.fun from the logged-in browser session.
 *
 * VERIFIED CONTRACT (reverse-engineered from frontend JS + live testing):
 *   POST https://frontend-api-v3.pump.fun/callout/create
 *   Headers: Content-Type: application/json, Origin: https://pump.fun
 *   Body:    { coinMint: <mint>, thesis: <text>, version: 2 }   (chainId omitted = sol)
 *   Auth:    session (Privy) — executed INSIDE the logged-in browser page context
 *   Gate:    account must hold >= $1 of tokens (INSUFFICIENT_BALANCE otherwise)
 *
 * Architecture: the poster drives the logged-in Chrome via CDP (port 9223) and
 * calls the endpoint from the page's own JS context (same-origin, full auth).
 * Usage:
 *   tsx src/callout-poster.ts <mint> <thesis>
 */
const CDP_PORT = process.env.CDP_PORT || "9223";
const API = "https://frontend-api-v3.pump.fun/callout/create";

async function cdpEvaluate(expression: string): Promise<any> {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((t: any) => t.type === "page" && t.url.includes("pump.fun")) || list.find((t: any) => t.type === "page");
  if (!page) throw new Error("no pump.fun page in Chrome");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method: string, params: any = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (ev: any) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  const res: any = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  ws.close();
  return res?.result?.value;
}

export async function postCallout(mint: string, thesis: string): Promise<{ ok: boolean; status?: number; body?: any; error?: string }> {
  const out = await cdpEvaluate(`(async () => {
    try {
      const r = await fetch(${JSON.stringify(API)}, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://pump.fun' },
        body: JSON.stringify({ coinMint: ${JSON.stringify(mint)}, thesis: ${JSON.stringify(thesis)}, version: 2 })
      });
      const body = await r.text();
      return { status: r.status, body: body.slice(0, 500) };
    } catch (e) { return { error: e.message }; }
  })()`);
  return out as any;
}

async function main() {
  const [mint, ...thesisParts] = process.argv.slice(2);
  if (!mint || !thesisParts.length) {
    console.log("usage: tsx src/callout-poster.ts <mint> <thesis text>");
    process.exit(1);
  }
  const thesis = thesisParts.join(" ");
  console.log(`posting callout for ${mint}: "${thesis.slice(0, 60)}..."`);
  const res = await postCallout(mint, thesis);
  console.log(JSON.stringify(res, null, 1));
  if (res.status === 200 || res.status === 201) {
    console.log("✅ CALLOUT POSTED");
  } else {
    console.log(`❌ failed (${res.status || res.error})`);
    if (res.body?.includes("INSUFFICIENT_BALANCE")) {
      console.log("→ account needs >= $1 in token holdings to post. Buy $5 of any coin, then retry.");
    }
  }
}

if (process.argv[1]?.endsWith("callout-poster.ts")) main();
