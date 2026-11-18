-- Spam shield (own, no third party): what was blocked / quarantined (30 days, masked contact only),
-- one-time challenge tokens already used (replay guard), and booking phone codes.
CREATE TABLE IF NOT EXISTS `spam_shield_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `form` VARCHAR(40) NOT NULL,
  `verdict` ENUM('blocked','quarantined','code') NOT NULL,
  `reasons` VARCHAR(255) NOT NULL,
  `score` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `contact_masked` VARCHAR(120) DEFAULT NULL COMMENT 'e.g. j***@gmail.com · ***-***-1234',
  `ip_hash` CHAR(16) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_spam_shield_log_created` (`created_at`),
  KEY `idx_spam_shield_log_form` (`form`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spam_shield_used` (
  `nonce` CHAR(24) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`nonce`),
  KEY `idx_spam_shield_used_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `public_phone_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone_e164` VARCHAR(20) NOT NULL,
  `purpose` ENUM('booking') NOT NULL DEFAULT 'booking',
  `code_hash` CHAR(64) NOT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `ip_hash` CHAR(16) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_public_phone_codes_phone` (`phone_e164`, `purpose`, `created_at`),
  KEY `idx_public_phone_codes_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
