-- Affiliate onboarding: e-signed Affiliate Agreement (EN/ES, versioned template),
-- online IRS W-9 (filled official PDF in the private vault; DB keeps last 4 only),
-- per-affiliate subscription price, and the two-level pay plan
-- (Referring $7 · Sponsor $1.50 · Senior Sponsor $1.50 when both exist; $7/$3 with
-- one sponsor; $10 alone). Existing projects stay on the one-level plan.

-- 1) Versioned agreement text (super_admin edits → publishes a new version).
CREATE TABLE IF NOT EXISTS `affiliate_agreement_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version` INT UNSIGNED NOT NULL,
  `body_en` MEDIUMTEXT NOT NULL COMMENT 'Light markup: # / ## headings, - bullets, | tables, **bold**, {{placeholders}}',
  `body_es` MEDIUMTEXT NOT NULL,
  `notes` VARCHAR(500) DEFAULT NULL,
  `published_at` DATETIME DEFAULT NULL COMMENT 'NULL = draft; latest published version is signed',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aff_agreement_version` (`version`),
  CONSTRAINT `fk_aff_agreement_tpl_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) One row per signature (re-sign on a new version adds a row; latest wins).
CREATE TABLE IF NOT EXISTS `affiliate_agreements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `template_version` INT UNSIGNED NOT NULL,
  `lang` ENUM('en','es') NOT NULL DEFAULT 'en',
  `status` ENUM('signed','void') NOT NULL DEFAULT 'signed',
  `legal_name` VARCHAR(200) NOT NULL,
  `business_name` VARCHAR(200) DEFAULT NULL,
  `title` VARCHAR(120) DEFAULT NULL,
  `address` VARCHAR(400) NOT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `email` VARCHAR(255) NOT NULL,
  `subscription_price_cents` INT UNSIGNED NOT NULL,
  `sponsor_affiliate_id` INT UNSIGNED DEFAULT NULL COMMENT 'Snapshot of parent at signing',
  `sponsor_name` VARCHAR(200) DEFAULT NULL,
  `body_sha256` CHAR(64) NOT NULL COMMENT 'Hash of the exact rendered text signed',
  `signature_image` MEDIUMTEXT NOT NULL COMMENT 'PNG data URL',
  `signed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `pdf_blob_pathname` VARCHAR(500) DEFAULT NULL COMMENT 'Private Blob: signed PDF',
  `voided_at` DATETIME DEFAULT NULL,
  `voided_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `void_reason` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aff_agreements_affiliate` (`affiliate_id`, `status`),
  CONSTRAINT `fk_aff_agreements_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aff_agreements_sponsor`
    FOREIGN KEY (`sponsor_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_aff_agreements_voider`
    FOREIGN KEY (`voided_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) W-9 submissions. Full TIN lives only inside the private PDF.
CREATE TABLE IF NOT EXISTS `affiliate_w9s` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `status` ENUM('submitted','accepted','rejected') NOT NULL DEFAULT 'submitted',
  `legal_name` VARCHAR(200) NOT NULL,
  `business_name` VARCHAR(200) DEFAULT NULL,
  `tax_classification` ENUM('individual','c_corp','s_corp','partnership','trust_estate','llc','other') NOT NULL,
  `llc_tax_class` CHAR(1) DEFAULT NULL COMMENT 'C | S | P when tax_classification = llc',
  `other_classification` VARCHAR(120) DEFAULT NULL,
  `tin_type` ENUM('ssn','ein') NOT NULL,
  `tin_last4` CHAR(4) NOT NULL,
  `address` VARCHAR(255) NOT NULL,
  `city_state_zip` VARCHAR(255) NOT NULL,
  `pdf_blob_pathname` VARCHAR(500) NOT NULL,
  `signed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `review_note` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aff_w9_affiliate` (`affiliate_id`, `status`),
  CONSTRAINT `fk_aff_w9_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aff_w9_reviewer`
    FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Price set by staff after the onboarding call (NULL = pending → cannot sign yet).
ALTER TABLE `affiliates`
  ADD COLUMN `subscription_price_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Monthly platform price printed in the agreement; NULL = pending';

-- 5) Two-level pay plan.
ALTER TABLE `affiliate_commissions`
  MODIFY COLUMN `role` ENUM('direct','closer','parent','grandparent') NOT NULL DEFAULT 'direct'
    COMMENT 'direct = full rate; closer = referring share; parent = sponsor; grandparent = senior sponsor';

-- TiDB: add columns first, then index / FK in separate statements.
ALTER TABLE `projects`
  ADD COLUMN `grandparent_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Senior Sponsor (sponsor''s sponsor) at project creation',
  ADD COLUMN `commission_plan` ENUM('one_level','two_level') NOT NULL DEFAULT 'two_level'
    COMMENT 'Pre-2026-10-15 projects stay one_level',
  ADD COLUMN `commission_rate_parent_shared_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen sponsor rate when a senior sponsor also earns',
  ADD COLUMN `commission_rate_grandparent_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen senior sponsor rate';

ALTER TABLE `projects` ADD KEY `idx_projects_grandparent_aff` (`grandparent_affiliate_id`);

ALTER TABLE `projects`
  ADD CONSTRAINT `fk_projects_grandparent_aff`
    FOREIGN KEY (`grandparent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL;

UPDATE `projects` SET `commission_plan` = 'one_level';

INSERT IGNORE INTO `system_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('commission_parent_shared_cents_per_sqft', '150', 'Sponsor share $/sqft cents ($1.50) when a Senior Sponsor also earns'),
  ('commission_grandparent_cents_per_sqft', '150', 'Senior Sponsor share $/sqft cents ($1.50)');
