-- Affiliate + Sub-affiliate (2-level) commissions per m² / sq ft.
-- Rates: direct $10, closer $7, parent $3 (configurable in system_settings).
-- Split ALTERs for TiDB (combined ADD COLUMN + KEY + FK can error 1072).

-- Parent pointer on affiliates (NULL = top-level Affiliate; set = Sub-affiliate).
ALTER TABLE `affiliates`
  ADD COLUMN `parent_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Immediate parent affiliate; NULL = top-level'
    AFTER `approved_by_admin_id`;

ALTER TABLE `affiliates`
  ADD KEY `idx_affiliates_parent` (`parent_affiliate_id`);

ALTER TABLE `affiliates`
  ADD CONSTRAINT `fk_affiliates_parent`
    FOREIGN KEY (`parent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL;

-- Snapshot attribution on the deal (closer = who brought the client).
ALTER TABLE `projects`
  ADD COLUMN `closer_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Affiliate who brought the client (payee closer/direct)'
    AFTER `affiliate_id`;

ALTER TABLE `projects`
  ADD COLUMN `parent_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen parent at enrollment when closer is a sub'
    AFTER `closer_affiliate_id`;

ALTER TABLE `projects`
  ADD KEY `idx_projects_closer` (`closer_affiliate_id`);

ALTER TABLE `projects`
  ADD KEY `idx_projects_parent_aff` (`parent_affiliate_id`);

ALTER TABLE `projects`
  ADD CONSTRAINT `fk_projects_closer`
    FOREIGN KEY (`closer_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL;

ALTER TABLE `projects`
  ADD CONSTRAINT `fk_projects_parent_aff`
    FOREIGN KEY (`parent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL;

-- Backfill: existing affiliate_id is the closer; no parent snapshot.
UPDATE `projects`
SET `closer_affiliate_id` = `affiliate_id`
WHERE `affiliate_id` IS NOT NULL AND `closer_affiliate_id` IS NULL;

-- Commission role for split payouts (two rows per project when parent active).
ALTER TABLE `affiliate_commissions`
  ADD COLUMN `role` ENUM('direct','closer','parent') NOT NULL DEFAULT 'direct'
    COMMENT 'direct = full $10; closer = $7; parent = $3 override'
    AFTER `affiliate_id`;

ALTER TABLE `affiliate_commissions`
  ADD KEY `idx_aff_comm_role` (`role`);

-- Split rate settings (cents per sq ft). Legacy commission_cents_per_sqft kept as synonym of direct.
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('commission_direct_cents_per_sqft', '1000', 'Affiliate direct commission $/sqft in cents ($10) when no sub in chain'),
  ('commission_closer_cents_per_sqft', '700', 'Sub-affiliate (closer) share $/sqft in cents ($7)'),
  ('commission_parent_cents_per_sqft', '300', 'Parent affiliate override $/sqft in cents ($3) when sub closes')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- Align legacy key description with direct rate.
UPDATE `system_settings`
SET `description` = 'Legacy alias of commission_direct_cents_per_sqft ($/sqft cents)'
WHERE `setting_key` = 'commission_cents_per_sqft';
