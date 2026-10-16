-- Affiliates can pick their own link name (/r/<slug>). Old names keep
-- resolving for 30 days so printed QR codes / flyers don't break, and nobody
-- else can claim them meanwhile.
CREATE TABLE IF NOT EXISTS `affiliate_slug_history` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `slug` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aff_slug_history_slug` (`slug`, `expires_at`),
  KEY `idx_aff_slug_history_affiliate` (`affiliate_id`),
  CONSTRAINT `fk_aff_slug_history_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `affiliates`
  ADD COLUMN `slug_changed_at` DATETIME DEFAULT NULL COMMENT 'Last self-service link-name change (once per 30 days)';
