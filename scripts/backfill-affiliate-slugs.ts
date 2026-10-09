/**
 * One-time / idempotent: assign vanity slugs to affiliates with null/empty slug.
 *
 *   npx tsx scripts/backfill-affiliate-slugs.ts
 *
 * Logic mirrors api/index.ts (firstname-lastname, -2/-3 collisions, reserved block).
 */
import "dotenv/config";
import crypto from "crypto";
import mysql from "mysql2/promise";

import { AFFILIATE_RESERVED_SLUGS } from "../shared/affiliateSlugReserved";

const RESERVED = new Set<string>(AFFILIATE_RESERVED_SLUGS);

function slugify(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function valid(slug: string): boolean {
  return (
    /^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$/.test(slug) &&
    slug.length >= 3 &&
    slug.length <= 64
  );
}

function baseFromName(first: string, last: string): string {
  const full = slugify(`${first || ""} ${last || ""}`);
  if (full.length >= 3) return full.slice(0, 64);
  const a = slugify(first);
  if (a.length >= 3) return a.slice(0, 64);
  const b = slugify(last);
  if (b.length >= 3) return b.slice(0, 64);
  const fallback = (a || b || "affiliate").slice(0, 60);
  return fallback.length >= 3 ? fallback : `${fallback}-gw`.slice(0, 64);
}

function randomCode(len: number): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" },
    timezone: "Z",
    connectionLimit: 2,
  });

  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, first_name, last_name FROM affiliates
       WHERE slug IS NULL OR TRIM(slug) = ''
       ORDER BY id ASC`,
    );
    let updated = 0;
    for (const row of rows) {
      const id = Number(row.id);
      const base = baseFromName(String(row.first_name || ""), String(row.last_name || ""));
      let chosen: string | null = null;
      for (let n = 0; n < 500; n++) {
        const suffix = n === 0 ? "" : `-${n + 1}`;
        const candidate = `${base.slice(0, Math.max(3, 64 - suffix.length))}${suffix}`;
        if (!valid(candidate) || RESERVED.has(candidate)) continue;
        const [taken] = await pool.query<mysql.RowDataPacket[]>(
          `SELECT id FROM affiliates WHERE slug = ? LIMIT 1`,
          [candidate],
        );
        if (!taken.length) {
          chosen = candidate;
          break;
        }
      }
      if (!chosen) {
        for (let i = 0; i < 8; i++) {
          const candidate = `aff-${randomCode(8)}`;
          const [taken] = await pool.query<mysql.RowDataPacket[]>(
            `SELECT id FROM affiliates WHERE slug = ? LIMIT 1`,
            [candidate],
          );
          if (!taken.length) {
            chosen = candidate;
            break;
          }
        }
      }
      if (!chosen) {
        console.error(`skip id=${id}: could not allocate`);
        continue;
      }
      await pool.execute(`UPDATE affiliates SET slug = ? WHERE id = ?`, [chosen, id]);
      updated += 1;
      console.log(`#${id} → ${chosen}`);
    }
    console.log(`Done. Updated ${updated} / ${rows.length} affiliates.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
