-- Client portal magic-link invites (5-day TTL). TiDB / MySQL 8 compatible.

CREATE TABLE IF NOT EXISTS `client_portal_invites` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(64) NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `created_by_type` ENUM('system','admin','affiliate') NOT NULL DEFAULT 'system',
  `created_by_id` INT UNSIGNED DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `accepted_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_portal_invite_token` (`token`),
  KEY `idx_client_portal_invite_client` (`client_id`),
  KEY `idx_client_portal_invite_email` (`email`),
  CONSTRAINT `fk_client_portal_invite_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
