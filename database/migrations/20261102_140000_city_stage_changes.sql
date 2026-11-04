-- Dated history of each city's pipeline stage: powers the City Partner journey tracker and activity feed.
CREATE TABLE IF NOT EXISTS `city_stage_changes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_id` INT UNSIGNED NOT NULL,
  `from_stage` VARCHAR(40) DEFAULT NULL,
  `to_stage` VARCHAR(40) DEFAULT NULL,
  `city_partner_id` INT UNSIGNED DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_city_stage_changes_city` (`city_id`, `id`),
  CONSTRAINT `fk_city_stage_changes_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
