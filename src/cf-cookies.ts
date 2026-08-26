import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.MEGAPHONE_DATA_DIR ?? path.join(process.cwd(), ".megaphone");

/**
 * Launch a real browser, solve Cloudflare by visiting pump.fun, and extract
 * the cf_clearance + auth_token cookies. These let the engine POST past CF.
 *
 * We inject our JWT into localStorage so the browser session is authenticated,
 * then read back the cookies pump.fun sets.
 */
async function main() {
  const token = JSON.parse(await fs.readFile(path.join(DATA_DIR, "token.json"), "utf8")).token;
  // wallet.key is plain base58 (not JSON)

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  // go to pump.fun root first to get CF cookies set
  console.log("[cf] navigating to pump.fun (solving Cloudflare)...");
  await page.goto("https://pump.fun", { waitUntil: "networkidle2", timeout: 60000 }).catch((e) =>
    console.log("[cf] goto warn:", e.message),
  );
  // wait a moment for CF challenge to clear
  await new Promise((r) => setTimeout(r, 5000));

  // inject our auth token so the session is logged in
  await page.evaluate((t) => {
    try {
      localStorage.setItem("auth_token", t);
      localStorage.setItem("pump_auth_token", t);
    } catch {}
  }, token);

  // visit the API as the browser to ensure cookies are established
  await page.goto("https://frontend-api-v3.pump.fun/auth/my-profile", {
    waitUntil: "networkidle2",
    timeout: 30000,
  }).catch(() => {});

  const cookies = await page.cookies();
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const hasCf = cookies.some((c) => c.name.includes("cf_clearance"));
  const hasAuth = cookies.some((c) => c.name.includes("auth_token"));

  console.log("[cf] cf_clearance:", hasCf, "| auth_token:", hasAuth);
  if (hasCf) {
    await fs.writeFile(path.join(DATA_DIR, "cookies.json"), cookieStr, { mode: 0o600 });
    console.log("[cf] cookies saved -> .megaphone/cookies.json");
  } else {
    console.log("[cf] no cf_clearance yet — Cloudflare may need more interaction");
    console.log("[cf] raw cookies:", cookieStr.slice(0, 200));
  }
  await browser.close();
}

main().catch((e) => {
  console.error("[cf] fatal", e);
  process.exit(1);
});
