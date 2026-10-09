/**
 * Affiliate vanity slug helpers.
 * Reserved list: import from shared (canonical). Keep api/index.ts inline Set in sync
 * — enforced by affiliateSlug.reserved.spec.ts.
 */
import { AFFILIATE_RESERVED_SLUGS as RESERVED_LIST } from "@shared/affiliateSlugReserved";

export const AFFILIATE_RESERVED_SLUGS = new Set<string>(RESERVED_LIST);

/** Accent-stripped lowercase dashed slug (max 64). */
export function slugifyAffiliate(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isValidAffiliateSlugFormat(slug: string): boolean {
  return (
    /^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$/.test(slug) &&
    slug.length >= 3 &&
    slug.length <= 64
  );
}

export function isReservedAffiliateSlug(slug: string): boolean {
  return AFFILIATE_RESERVED_SLUGS.has(String(slug || "").toLowerCase());
}

/** Default vanity base from first + last name (no uniqueness suffix). */
export function baseSlugFromAffiliateName(
  firstName: string,
  lastName: string,
): string {
  const full = slugifyAffiliate(`${firstName || ""} ${lastName || ""}`);
  if (full.length >= 3) return full.slice(0, 64);
  const first = slugifyAffiliate(firstName);
  if (first.length >= 3) return first.slice(0, 64);
  const last = slugifyAffiliate(lastName);
  if (last.length >= 3) return last.slice(0, 64);
  const fallback = (first || last || "affiliate").slice(0, 60);
  return fallback.length >= 3 ? fallback : `${fallback}-gw`.slice(0, 64);
}
