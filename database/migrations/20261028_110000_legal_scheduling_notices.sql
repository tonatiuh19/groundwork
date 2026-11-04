-- Legal pages: a published version becomes live on its effective date (scheduled when in the future),
-- and members get an email notice about material changes (sent in batches by cron, once per person).
ALTER TABLE `legal_documents` ADD COLUMN `notify_members` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Email active/pending affiliates and contractors about this version';

CREATE TABLE IF NOT EXISTS `legal_notices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` ENUM('terms','privacy','refunds') NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `person_kind` ENUM('affiliate','contractor') NOT NULL,
  `person_id` INT UNSIGNED NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_notice` (`slug`, `version`, `person_kind`, `person_id`),
  KEY `idx_legal_notice_person` (`person_kind`, `person_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
