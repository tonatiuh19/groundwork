-- Admin billing: action log, staff-sent card links, affiliate price override.

ALTER TABLE `affiliates`
  ADD COLUMN `billing_price_override_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Staff override of the agreement price; NULL = agreement price, 0 = waived';

CREATE TABLE IF NOT EXISTS `billing_admin_actions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_role` ENUM('affiliate','contractor') NOT NULL,
  `member_id` INT UNSIGNED NOT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `action` VARCHAR(40) NOT NULL COMMENT 'cancel_now | cancel_period_end | resume | extend | refund | price | card_link',
  `reason` TEXT DEFAULT NULL,
  `detail_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_billing_actions_member` (`member_role`, `member_id`),
  CONSTRAINT `fk_billing_actions_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `billing_card_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_role` ENUM('affiliate','contractor') NOT NULL,
  `member_id` INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `price_cents` INT UNSIGNED DEFAULT NULL COMMENT 'NULL = keep the member price',
  `free_days` INT UNSIGNED DEFAULT NULL COMMENT 'NULL = standard rule (trial once)',
  `note` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME DEFAULT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_card_link_token` (`token_hash`),
  KEY `idx_billing_card_link_member` (`member_role`, `member_id`),
  CONSTRAINT `fk_billing_card_link_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
