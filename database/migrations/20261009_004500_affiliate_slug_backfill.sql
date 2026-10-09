-- Affiliate vanity slugs: column already exists (nullable UNIQUE).
-- Name-based defaults + collision suffixes are applied by
--   npx tsx scripts/backfill-affiliate-slugs.ts
-- (accent-aware; same rules as api/index.ts allocateUniqueAffiliateSlug).
-- New creates always set slug in application code.
-- This file is a no-op marker so migrate history records the rollout.
SELECT 1;
