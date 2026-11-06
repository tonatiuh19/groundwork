-- City Partners ask for a city; staff approve (adds + assigns it) or decline.
CREATE TABLE IF NOT EXISTS `city_partner_city_requests` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `city_name` VARCHAR(100) NOT NULL,
  `county` VARCHAR(100) DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `status` ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
  `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'City added / assigned on approve',
  `decline_reason` VARCHAR(500) DEFAULT NULL,
  `decided_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `decided_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cp_city_requests_status` (`status`, `id`),
  KEY `idx_cp_city_requests_partner` (`city_partner_id`, `id`),
  CONSTRAINT `fk_cp_city_requests_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- City meetings booked by a City Partner from the city page (invite Groundwork staff; Outlook sync like any CRM appointment).
ALTER TABLE `appointments` MODIFY COLUMN `kind` ENUM('property_inspection','site_visit','lender_meeting','consultation','call','city_meeting','other') NOT NULL DEFAULT 'consultation';
ALTER TABLE `appointments` MODIFY COLUMN `source` ENUM('staff','booking','outlook','city_partner') NOT NULL DEFAULT 'staff';
ALTER TABLE `appointments` ADD COLUMN `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'City meeting: service_cities';
ALTER TABLE `appointments` ADD COLUMN `city_partner_id` INT UNSIGNED DEFAULT NULL COMMENT 'City meeting booked by this City Partner';
ALTER TABLE `appointments` ADD KEY `idx_appointments_city_partner` (`city_partner_id`, `starts_at`);
