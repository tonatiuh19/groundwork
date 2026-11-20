-- Affiliate addenda (special agreements): a per-affiliate contract on top of the affiliate agreement
-- that pays a rate per sq ft on projects from linked events and / or from assigned affiliates' clients.
-- pay_mode replace = the rate replaces the affiliate's own commission on those projects (sponsors unchanged);
-- extra = paid on top. Staff draft → send (text frozen) → affiliate signs → super admin countersigns → accrues
-- with the loan like every commission (affiliate_commissions.role 'addendum' or the row tagged addendum_id).
CREATE TABLE IF NOT EXISTS `affiliate_addenda` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `body_en` MEDIUMTEXT NOT NULL COMMENT 'Staff text: light markup + {{placeholders}}',
  `body_es` MEDIUMTEXT NOT NULL,
  `rate_cents_per_sqft` INT UNSIGNED NOT NULL DEFAULT 100,
  `pay_mode` ENUM('replace','extra') NOT NULL DEFAULT 'replace',
  `status` ENUM('draft','sent','signed','countersigned','void') NOT NULL DEFAULT 'draft',
  `rendered_en` MEDIUMTEXT DEFAULT NULL COMMENT 'Frozen at send',
  `rendered_es` MEDIUMTEXT DEFAULT NULL,
  `lang` ENUM('en','es') DEFAULT NULL COMMENT 'Language signed',
  `body_sha256` CHAR(64) DEFAULT NULL COMMENT 'SHA-256 of the exact text signed',
  `sent_at` DATETIME DEFAULT NULL,
  `signed_at` DATETIME DEFAULT NULL,
  `signed_name` VARCHAR(200) DEFAULT NULL,
  `signature_image` MEDIUMTEXT DEFAULT NULL COMMENT 'PNG data URL',
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `countersigned_at` DATETIME DEFAULT NULL,
  `countersigned_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `countersigned_name` VARCHAR(200) DEFAULT NULL,
  `voided_at` DATETIME DEFAULT NULL,
  `voided_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `void_reason` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_affiliate_addenda_affiliate` (`affiliate_id`, `status`),
  KEY `idx_affiliate_addenda_status` (`status`),
  CONSTRAINT `fk_affiliate_addenda_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_affiliate_addenda_countersigner` FOREIGN KEY (`countersigned_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_affiliate_addenda_voider` FOREIGN KEY (`voided_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_affiliate_addenda_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Events whose sign-ups (RSVP leads → their projects) count.
CREATE TABLE IF NOT EXISTS `affiliate_addendum_events` (
  `addendum_id` INT UNSIGNED NOT NULL,
  `event_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`addendum_id`, `event_id`),
  KEY `idx_affiliate_addendum_events_event` (`event_id`),
  CONSTRAINT `fk_aae_addendum` FOREIGN KEY (`addendum_id`) REFERENCES `affiliate_addenda`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aae_event` FOREIGN KEY (`event_id`) REFERENCES `marketing_events`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Affiliates whose clients count (e.g. a mortgage company owner's loan officers).
CREATE TABLE IF NOT EXISTS `affiliate_addendum_affiliates` (
  `addendum_id` INT UNSIGNED NOT NULL,
  `affiliate_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`addendum_id`, `affiliate_id`),
  KEY `idx_affiliate_addendum_affiliates_aff` (`affiliate_id`),
  CONSTRAINT `fk_aaa_addendum` FOREIGN KEY (`addendum_id`) REFERENCES `affiliate_addenda`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aaa_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff overrides per project: include (counts even without a match) or exclude (never counts).
CREATE TABLE IF NOT EXISTS `affiliate_addendum_projects` (
  `addendum_id` INT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `mode` ENUM('include','exclude') NOT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`addendum_id`, `project_id`),
  KEY `idx_aap_project` (`project_id`),
  CONSTRAINT `fk_aap_addendum` FOREIGN KEY (`addendum_id`) REFERENCES `affiliate_addenda`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aap_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aap_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every change (create, edit, send, sign, countersign, void, project include / exclude).
CREATE TABLE IF NOT EXISTS `affiliate_addendum_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `addendum_id` INT UNSIGNED NOT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `action` VARCHAR(40) NOT NULL,
  `detail` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aal_addendum` (`addendum_id`, `id`),
  CONSTRAINT `fk_aal_addendum` FOREIGN KEY (`addendum_id`) REFERENCES `affiliate_addenda`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aal_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One change per statement (TiDB).
ALTER TABLE `affiliate_commissions` MODIFY COLUMN `role` ENUM('direct','closer','parent','grandparent','addendum') NOT NULL DEFAULT 'direct' COMMENT 'direct = full rate; closer = referring share; parent = sponsor; grandparent = senior sponsor; addendum = special agreement';
ALTER TABLE `affiliate_commissions` ADD COLUMN `addendum_id` INT UNSIGNED DEFAULT NULL COMMENT 'Special agreement that set this row (replace / extra / its own row)';
ALTER TABLE `affiliate_commissions` ADD KEY `idx_aff_comm_addendum` (`addendum_id`);
ALTER TABLE `affiliate_commissions` ADD CONSTRAINT `fk_aff_comm_addendum` FOREIGN KEY (`addendum_id`) REFERENCES `affiliate_addenda`(`id`) ON DELETE SET NULL;
ALTER TABLE `affiliate_commissions` ADD COLUMN `addendum_base_cents` INT DEFAULT NULL COMMENT 'The row amount before a special agreement replaced / added to it (restored if it stops applying)';
