-- In-app staff alert inbox (Settings → Team notifications → In-app channel)
CREATE TABLE IF NOT EXISTS `admin_notifications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `event_key` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT DEFAULT NULL,
  `link_url` VARCHAR(500) DEFAULT NULL,
  `payload_json` JSON DEFAULT NULL,
  `read_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_notifications_admin_created` (`admin_id`, `created_at`),
  KEY `idx_admin_notifications_admin_unread` (`admin_id`, `read_at`),
  KEY `idx_admin_notifications_event` (`event_key`),
  CONSTRAINT `fk_admin_notifications_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
