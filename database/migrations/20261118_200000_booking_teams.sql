-- Company (team) booking pages: one public link (e.g. /book/groundwork) shared by several staff.
-- A slot is open when at least one member is free (their own weekly hours, days off and calendar).
-- Every member is alerted (email + bell + text); the first to claim owns it, admins can reassign.
CREATE TABLE IF NOT EXISTS `booking_teams` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `slug` VARCHAR(80) NOT NULL,
  `name` VARCHAR(200) NOT NULL DEFAULT 'Groundwork Capital' COMMENT 'Shown as the host on the public page',
  `title_en` VARCHAR(200) NOT NULL DEFAULT 'ADU consultation',
  `title_es` VARCHAR(200) NOT NULL DEFAULT 'Consulta de ADU',
  `description_en` TEXT DEFAULT NULL,
  `description_es` TEXT DEFAULT NULL,
  `kind` ENUM('property_inspection','site_visit','lender_meeting','consultation','call','other') NOT NULL DEFAULT 'consultation',
  `duration_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  `buffer_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  `advance_days` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  `min_notice_hours` SMALLINT UNSIGNED NOT NULL DEFAULT 4,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles',
  `allow_phone` TINYINT(1) NOT NULL DEFAULT 1,
  `allow_video` TINYINT(1) NOT NULL DEFAULT 0,
  `allow_office` TINYINT(1) NOT NULL DEFAULT 0,
  `allow_onsite` TINYINT(1) NOT NULL DEFAULT 0,
  `video_url` VARCHAR(500) DEFAULT NULL,
  `booking_types_json` JSON DEFAULT NULL,
  `default_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Holds an unclaimed booking (when free); else the first free member',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_teams_slug` (`slug`),
  CONSTRAINT `fk_booking_teams_default_admin` FOREIGN KEY (`default_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_team_members` (
  `team_id` INT UNSIGNED NOT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`team_id`, `admin_id`),
  KEY `idx_booking_team_members_admin` (`admin_id`),
  CONSTRAINT `fk_booking_team_members_team` FOREIGN KEY (`team_id`) REFERENCES `booking_teams`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_booking_team_members_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One change per statement: TiDB can't reference a column added in the same ALTER.
ALTER TABLE `appointments` ADD COLUMN `booking_team_id` INT UNSIGNED DEFAULT NULL COMMENT 'Booked on a company (team) page' AFTER `city_partner_id`;
ALTER TABLE `appointments` ADD COLUMN `claimed_at` DATETIME DEFAULT NULL COMMENT 'Team booking: when a member took it (NULL = unclaimed)' AFTER `booking_team_id`;
ALTER TABLE `appointments` ADD COLUMN `claimed_by_admin_id` INT UNSIGNED DEFAULT NULL AFTER `claimed_at`;
ALTER TABLE `appointments` ADD KEY `idx_appointments_team_claim` (`booking_team_id`, `claimed_at`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_booking_team` FOREIGN KEY (`booking_team_id`) REFERENCES `booking_teams`(`id`) ON DELETE SET NULL;
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_claimed_by` FOREIGN KEY (`claimed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL;
