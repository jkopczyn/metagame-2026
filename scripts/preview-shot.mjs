// Screenshot a preview deployment or `pnpm dev:local` at phone and desktop
// widths, signed in as the seed admin, and flag any page wider than its viewport.
//   node scripts/preview-shot.mjs https://metagame-2026-xxx.vercel.app /backstage/tickets [/more/paths]
// Exits 1 if sign-in fails; SHOT_EMAIL= (empty) skips it to shoot signed out.
// Previews read the Vercel bypass key from VERCEL_BYPASS or
// ~/.config/vercel/metagame-2026-bypass; localhost doesn't need one.
// Screenshots land in preview-shots/ (gitignored). Tap a selector before the
// phone shot with TAP='ul li button' to capture a modal. SHOT_BROWSER points
// at a Chromium binary when the one `npx playwright install` fetches is absent.
import { readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const [base, ...paths] = process.argv.slice(2);
if (!base || paths.length === 0) {
  console.error("usage: preview-shot.mjs <base-url> <path> [path...]");
  process.exit(2);
}
function readBypass() {
  if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
    return null;
  }
  if (process.env.VERCEL_BYPASS) return process.env.VERCEL_BYPASS;
  try {
    return readFileSync(
      join(homedir(), ".config/vercel/metagame-2026-bypass"),
      "utf8",
    ).trim();
  } catch {
    console.warn("no Vercel bypass key; a protected preview will refuse this");
    return null;
  }
}
const bypass = readBypass();
const email = process.env.SHOT_EMAIL ?? "admin@metagame.games";
const password = process.env.SHOT_PASSWORD ?? "metagame";
const out = "preview-shots";
mkdirSync(out, { recursive: true });

const sizes = [
  {
    name: "phone",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  { name: "desktop", viewport: { width: 1280, height: 900 } },
];

const browser = await chromium.launch({
  executablePath: process.env.SHOT_BROWSER,
});
let failed = false;
try {
  for (const size of sizes) {
    const ctx = await browser.newContext({
      ...size,
      deviceScaleFactor: 2,
      extraHTTPHeaders: bypass
        ? {
            "x-vercel-protection-bypass": bypass,
            "x-vercel-set-bypass-cookie": "true",
          }
        : {},
    });
    if (email) {
      const r = await ctx.request.post(`${base}/api/auth/sign-in/email`, {
        data: { email, password },
        headers: { Origin: base },
      });
      if (!r.ok()) {
        throw new Error(
          `sign-in as ${email} failed with ${r.status()}, so screenshots would only show the sign-in card`,
        );
      }
    }
    const page = await ctx.newPage();
    for (const path of paths) {
      const slug = (path.replace(/^\/+/, "") || "index").replace(
        /[^\w-]+/g,
        "_",
      );
      await page.goto(base + path, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      await page.waitForTimeout(400);
      if (size.name === "phone" && process.env.TAP) {
        await page.locator(process.env.TAP).first().click();
        await page.waitForTimeout(500);
      }
      const width = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      const wide = width > size.viewport.width;
      if (wide) failed = true;
      const file = `${out}/${slug}-${size.name}.png`;
      await page.screenshot({ path: file, fullPage: !process.env.TAP });
      console.log(
        `${wide ? "OVERFLOW" : "ok"} ${size.name} ${path} width=${width} → ${file}`,
      );
    }
    await ctx.close();
  }
} catch (error) {
  console.error(error.message);
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
