-- Who changed what on a City Partner (rate, LLC name, status, cities), for disputes and audits.
CREATE TABLE IF NOT EXISTS `city_partner_changes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `field` VARCHAR(40) NOT NULL,
  `before_text` VARCHAR(500) DEFAULT NULL,
  `after_text` VARCHAR(500) DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cp_changes_partner` (`city_partner_id`, `id`),
  CONSTRAINT `fk_cp_changes_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
