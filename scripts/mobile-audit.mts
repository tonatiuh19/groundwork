/**
 * Mobile audit: opens every staff / affiliate / contractor portal page at phone widths and fails when
 * anything scrolls sideways — the page itself, an inner `overflow-x: auto` container, or content clipped
 * past the screen edge. Saves 375px screenshots for visual review.
 *
 *   (dev server running, NOTIFY_SANDBOX=true)   npx tsx scripts/mobile-audit.mts [outDir]
 *
 * Uses @example.com fixture sessions (prefix gwqa-<ts>-) and cleans them up. Never signs in as real staff.
 */
import "dotenv/config";
import crypto from "crypto";
import { mkdirSync } from "fs";
import { chromium } from "playwright";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "../api/testDbCleanup.ts";

const BASE = process.env.E2E_BASE || "https://localhost:8080";
const OUT = process.argv[2] || "mobile-audit";
const WIDTHS = [320, 375];
mkdirSync(OUT, { recursive: true });

const db = createIntegrationTestPool();
const prefix = `gwqa-${Date.now()}-`;
const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
const session = async (actor: string, id: number) => {
  const t = crypto.randomBytes(32).toString("hex");
  await db.execute(`INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 2 HOUR)`, [id, sha(t)]);
  return t;
};

let failures = 0;
try {
  const tokens = {
    gw_admin_sid: await session("admin", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Mobile', 'Audit', 'super_admin', 'active')`, [`${prefix}admin@example.com`])),
    gw_affiliate_sid: await session(
      "affiliate",
      await ins(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code, slug, approved_at) VALUES (?, 'Ana', 'Audit', 'active', ?, ?, NOW())`, [
        `${prefix}aff@example.com`,
        `QA${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        `${prefix}ana`,
      ]),
    ),
    gw_contractor_sid: await session(
      "contractor",
      await ins(`INSERT INTO contractors (email, first_name, last_name, status, preferred_language, activated_at) VALUES (?, 'Cal', 'Audit', 'active', 'en', NOW())`, [`${prefix}ctr@example.com`]),
    ),
  };
  // Real detail pages (read-only) so long, real-world content is exercised.
  const first = async (sql: string) => (((await db.query(sql)) as any)[0][0] ?? null) as any;
  const c = await first(`SELECT id FROM clients ORDER BY id DESC LIMIT 1`);
  const a = await first(`SELECT id FROM affiliates WHERE email NOT LIKE 'gw%' ORDER BY id DESC LIMIT 1`);
  const k = await first(`SELECT id FROM contractors WHERE email NOT LIKE 'gw%' ORDER BY id DESC LIMIT 1`);
  const p = await first(`SELECT public_id FROM projects ORDER BY id DESC LIMIT 1`);
  const pages = [
    ...["", "leads", "calendar", "events", "campaigns", "conversations", "templates", "contacts", "projects", "clients", "affiliates", "contractors", "draws", "commissions", "billing", "staff", "settings", "profile", "plans"].map((x) => `/admin/${x}`),
    ...(c ? [`/admin/clients/${c.id}`] : []),
    ...(a ? [`/admin/affiliates/${a.id}`] : []),
    ...(k ? [`/admin/contractors/${k.id}`] : []),
    ...(p ? [`/admin/projects/${p.public_id}`] : []),
    ...["", "clients", "team", "commissions", "link", "agreement", "help", "profile", "appointments"].map((x) => `/affiliate/${x}`),
    ...["", "projects", "appointments", "photos", "draws"].map((x) => `/contractor/${x}`),
  ];

  const browser = await chromium.launch();
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.addCookies(
      Object.entries(tokens).map(([name, value]) => ({ name, value, domain: new URL(BASE).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" as const })),
    );
    const page = await ctx.newPage();
    for (const path of pages) {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2600);
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const pageOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
        const issues: string[] = [];
        document.querySelectorAll("body *").forEach((el) => {
          const h = el as HTMLElement;
          const cs = getComputedStyle(h);
          const name = `${h.tagName.toLowerCase()}.${String(h.className).split(" ")[0]}`;
          if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && h.clientWidth > 0 && h.scrollWidth > h.clientWidth + 2) {
            issues.push(`scrolls:${name}(+${h.scrollWidth - h.clientWidth})`);
          }
          const rect = h.getBoundingClientRect();
          if (rect.width && rect.right > vw + 2 && cs.position !== "fixed") {
            let n = h.parentElement;
            while (n && n !== document.body) {
              const ncs = getComputedStyle(n);
              if (ncs.overflowX !== "visible") {
                // Intentional truncation ("…") is fine; anything else is cut off.
                if (ncs.textOverflow !== "ellipsis") issues.push(`clipped:${name}(${Math.round(rect.right - vw)}px)`);
                break;
              }
              n = n.parentElement;
            }
          }
        });
        return { pageOverflow, issues: [...new Set(issues)].slice(0, 5) };
      });
      const bad = r.pageOverflow > 0 || r.issues.length > 0;
      if (bad) failures++;
      console.log(`${bad ? "✗" : "✓"} ${width} ${path} ${r.pageOverflow > 0 ? `page+${r.pageOverflow}px ` : ""}${r.issues.join(" ")}`);
      if (width === 375) await page.screenshot({ path: `${OUT}/${path.replace(/\//g, "_") || "_root"}.png`, fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  await cleanupPortalFixturesByPrefix(db, prefix);
  await db.end();
}
console.log(failures ? `\n${failures} page(s) scroll sideways` : "\nNo sideways scrolling at 320 / 375px");
process.exitCode = failures ? 1 : 0;
