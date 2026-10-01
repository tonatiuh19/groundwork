-- Groundwork Capital — initial schema (TiDB Cloud / MySQL 8 compatible)
-- Creates staff admins, lead capture, notify extras, and system settings.
-- Seeds platform owners: Daniel Carrillo + Cesar Gomez.

CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `role` ENUM('super_admin','admin','agent','affiliate') NOT NULL DEFAULT 'admin',
  `status` ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `language_owner_for` ENUM('en','es') DEFAULT NULL,
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `notification_prefs_json` JSON DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admins_email` (`email`),
  KEY `idx_admins_status` (`status`),
  KEY `idx_admins_role` (`role`),
  UNIQUE KEY `uq_admins_language_owner_for` (`language_owner_for`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_notify_extra_emails` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `label` VARCHAR(100) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `events_json` JSON DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notify_extra_email` (`email`),
  KEY `idx_notify_extra_active` (`is_active`),
  CONSTRAINT `fk_notify_extra_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `leads` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(200) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(40) NOT NULL,
  `property_address` VARCHAR(500) NOT NULL,
  `soft_pull_consent` TINYINT(1) NOT NULL DEFAULT 0,
  `mode` ENUM('event','standard') NOT NULL DEFAULT 'standard',
  `event_city` VARCHAR(100) DEFAULT NULL,
  `source` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('new','contacted','qualified','closed','spam') NOT NULL DEFAULT 'new',
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_leads_email` (`email`),
  KEY `idx_leads_status` (`status`),
  KEY `idx_leads_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(100) NOT NULL,
  `setting_value` MEDIUMTEXT DEFAULT NULL,
  `description` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_system_settings_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('company_name', 'Groundwork Capital', 'Company display name'),
  ('support_email', 'hello@groundworkcapitalgroup.com', 'Public-facing support email'),
  ('app_version', '0.1.0', 'Current deployed application version')
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`);

-- Platform owners (staff notify fan-out: super_admin / admin / agent)
INSERT INTO `admins` (
  `email`, `first_name`, `last_name`, `role`, `status`, `preferred_language`, `language_owner_for`
) VALUES
  ('teamdc@encoremortgage.org', 'Daniel', 'Carrillo', 'super_admin', 'active', 'en', 'en'),
  ('cesar@optimum-financial-group.com', 'Cesar', 'Gomez', 'super_admin', 'active', 'en', NULL)
ON DUPLICATE KEY UPDATE
  `first_name` = VALUES(`first_name`),
  `last_name` = VALUES(`last_name`),
  `role` = VALUES(`role`),
  `status` = 'active';
