/**
 * Authenticated portal mobile overflow audit (Playwright).
 *
 *   npx tsx scripts/portal-mobile-overflow-audit.ts
 *
 * Expects local https://localhost:8080 and sessions minted via mint-portal-sessions.
 * Pass cookies via env:
 *   GW_ADMIN_COOKIE=... GW_AFFILIATE_COOKIE=... GW_CONTRACTOR_COOKIE=... GW_CLIENT_COOKIE=...
 */
import { chromium, type Cookie } from "playwright";

const BASE = process.env.GW_MOBILE_AUDIT_BASE || "https://localhost:8080";

type Portal = {
  name: string;
  cookieHeader: string | undefined;
  paths: string[];
};

const portals: Portal[] = [
  {
    name: "admin",
    cookieHeader: process.env.GW_ADMIN_COOKIE,
    paths: [
      "/admin",
      "/admin/leads",
      "/admin/campaigns",
      "/admin/clients",
      "/admin/projects",
      "/admin/conversations",
      "/admin/settings",
      "/admin/profile",
    ],
  },
  {
    name: "affiliate",
    cookieHeader: process.env.GW_AFFILIATE_COOKIE,
    paths: [
      "/affiliate",
      "/affiliate/clients",
      "/affiliate/commissions",
      "/affiliate/link",
      "/affiliate/profile",
    ],
  },
  {
    name: "contractor",
    cookieHeader: process.env.GW_CONTRACTOR_COOKIE,
    paths: [
      "/contractor",
      "/contractor/projects",
      "/contractor/draws",
      "/contractor/photos",
    ],
  },
  {
    name: "client",
    cookieHeader: process.env.GW_CLIENT_COOKIE,
    paths: ["/client", "/client/project", "/client/documents"],
  },
];

function parseCookie(header: string): Cookie {
  const [nv] = header.split(";");
  const eq = nv.indexOf("=");
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  return {
    name,
    value,
    domain: "localhost",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    expires: Math.floor(Date.now() / 1000) + 7200,
  };
}

async function measure(page: import("playwright").Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: Array<{ cls: string; right: number; w: number }> = [];
    const containedSel =
      ".pf-board, .pf-tracker, .pf-table-wrap, .gw-campaigns-audience-wrap";
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement)) continue;
      // Contained chip nav / boards may extend; must not widen the document.
      if (el.closest(containedSel)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.right <= window.innerWidth + 2) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      // Fixed/portaled overlays (e.g. inbox panel) are allowed off-viewport.
      if (cs.position === "fixed" || cs.position === "sticky") continue;
      offenders.push({
        cls: String(el.className || el.tagName).slice(0, 90),
        right: Math.round(r.right),
        w: Math.round(r.width),
      });
    }
    offenders.sort((a, b) => b.right - a.right);
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const booted =
      !!document.querySelector(
        ".portal-sidebar, .portal-login, .portal-shell",
      ) && !/Loading portal/i.test(text);
    const onLogin =
      /\/login(?:$|\?)/.test(location.pathname) ||
      !!document.querySelector(".portal-login");
    // Also flag shell wider than viewport (overflow-x:hidden can mask scrollWidth).
    const shell = document.querySelector(".portal-shell, .portal-sidebar");
    const shellW = shell instanceof HTMLElement ? shell.scrollWidth : 0;
    const shellOverflow = shellW > window.innerWidth + 2;
    return {
      path: location.pathname,
      title: document.title,
      vw: window.innerWidth,
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
      shellW,
      hasHScroll: doc.scrollWidth > doc.clientWidth + 1 || shellOverflow,
      booted,
      onLogin,
      bodyTextHint: text.slice(0, 100),
      offenders: offenders.slice(0, 6),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results: unknown[] = [];
  let failed = 0;

  for (const portal of portals) {
    if (!portal.cookieHeader) {
      results.push({ portal: portal.name, skipped: "no cookie" });
      continue;
    }
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });
    await context.addCookies([parseCookie(portal.cookieHeader)]);
    const page = await context.newPage();

    // Warm auth before first navigation (avoids cold-proxy login redirects).
    try {
      await page.goto(`${BASE}/api/${portal.name}/auth/me`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
    } catch {
      /* non-fatal */
    }

    for (const path of portal.paths) {
      try {
        const visit = async () => {
          await page.goto(`${BASE}${path}`, {
            waitUntil: "networkidle",
            timeout: 45000,
          });
          await page
            .waitForFunction(
              () => {
                const t = (document.body?.innerText || "").replace(/\s+/g, " ");
                return (
                  !!document.querySelector(
                    ".portal-sidebar, .portal-login",
                  ) && !/Loading portal/i.test(t)
                );
              },
              { timeout: 20000 },
            )
            .catch(() => {});
          await page.waitForTimeout(400);
          return measure(page);
        };

        let m = await visit();
        // Retries if auth race sent us to login (cold proxy / first paint).
        for (let i = 0; i < 2 && m.onLogin; i += 1) {
          await page.waitForTimeout(700);
          m = await visit();
        }
        const ok = !m.hasHScroll && m.booted && !m.onLogin;
        if (!ok) failed += 1;
        results.push({ portal: portal.name, requested: path, ...m, ok });
      } catch (e: any) {
        failed += 1;
        results.push({
          portal: portal.name,
          path,
          ok: false,
          error: String(e?.message || e).slice(0, 200),
        });
      }
    }
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify({ failed, results }, null, 2));
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
