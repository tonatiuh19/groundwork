-- Cities managed in Settings: one clean list for sign-up pickers, admin filters and city reports.
-- Coverage is visibility only; it does not affect commissions or who gets credit.
CREATE TABLE IF NOT EXISTS `service_cities` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service_cities_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `service_cities` (`name`) VALUES ('Fontana');

CREATE TABLE IF NOT EXISTS `affiliate_cities` (
  `affiliate_id` INT UNSIGNED NOT NULL,
  `city_id` INT UNSIGNED NOT NULL,
  `assigned` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0 = asked for at sign-up, 1 = staff assigned',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`affiliate_id`, `city_id`),
  KEY `idx_affiliate_cities_city` (`city_id`),
  CONSTRAINT `fk_affiliate_cities_aff` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_affiliate_cities_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractor_cities` (
  `contractor_id` INT UNSIGNED NOT NULL,
  `city_id` INT UNSIGNED NOT NULL,
  `assigned` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0 = asked for at sign-up, 1 = staff assigned',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`contractor_id`, `city_id`),
  KEY `idx_contractor_cities_city` (`city_id`),
  CONSTRAINT `fk_contractor_cities_ctr` FOREIGN KEY (`contractor_id`) REFERENCES `contractors` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contractor_cities_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'service_cities; property city';
ALTER TABLE `leads` ADD INDEX IF NOT EXISTS `idx_leads_city` (`city_id`);
ALTER TABLE `clients` ADD COLUMN IF NOT EXISTS `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'service_cities; property city';
ALTER TABLE `clients` ADD INDEX IF NOT EXISTS `idx_clients_city` (`city_id`);
ALTER TABLE `projects` ADD COLUMN IF NOT EXISTS `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'service_cities; property city';
ALTER TABLE `projects` ADD INDEX IF NOT EXISTS `idx_projects_city` (`city_id`);
