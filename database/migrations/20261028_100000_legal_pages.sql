-- Public legal pages (Terms of Service, Privacy Policy, Refund & Cancellation), versioned and editable
-- in admin (draft → publish by a super admin), plus who accepted which version, and the free-period
-- ending reminder (California: notice 3-21 days before a trial longer than 31 days converts to paid).

CREATE TABLE IF NOT EXISTS `legal_documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` ENUM('terms','privacy','refunds') NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `status` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  `title_en` VARCHAR(200) NOT NULL,
  `title_es` VARCHAR(200) NOT NULL,
  `body_en` MEDIUMTEXT NOT NULL COMMENT 'Markdown: # / ## / ### headings, - bullets, | tables, **bold**, [links](url), {{live fields}}',
  `body_es` MEDIUMTEXT NOT NULL,
  `effective_date` DATE DEFAULT NULL COMMENT 'Set when published',
  `requires_reacceptance` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Material change: members accept again on next portal visit',
  `notes` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `published_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `published_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_slug_version` (`slug`, `version`),
  KEY `idx_legal_slug_status` (`slug`, `status`),
  CONSTRAINT `fk_legal_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_legal_publisher` FOREIGN KEY (`published_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `legal_acceptances` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `person_kind` ENUM('affiliate','contractor','client') NOT NULL,
  `person_id` INT UNSIGNED NOT NULL,
  `slug` ENUM('terms','privacy','refunds') NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `context` ENUM('signup','reaccept','staff') NOT NULL DEFAULT 'signup',
  `accepted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_accept` (`person_kind`, `person_id`, `slug`, `version`),
  KEY `idx_legal_accept_person` (`person_kind`, `person_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `affiliates` ADD COLUMN `billing_trial_reminder_sent_at` DATETIME DEFAULT NULL COMMENT 'Free period ending notice sent (once per free period)';
ALTER TABLE `contractors` ADD COLUMN `billing_trial_reminder_sent_at` DATETIME DEFAULT NULL COMMENT 'Free period ending notice sent (once per free period)';
