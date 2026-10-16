-- Lenders directory + scheduler (appointments, tagged attendees, per-staff
-- booking links). Appointment times are stored in UTC with the display
-- timezone kept per appointment.

CREATE TABLE IF NOT EXISTS `lenders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company` VARCHAR(200) NOT NULL,
  `contact_name` VARCHAR(200) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `notes` TEXT DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lenders_active` (`is_active`),
  CONSTRAINT `fk_lenders_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `projects`
  ADD COLUMN `lender_id` INT UNSIGNED DEFAULT NULL COMMENT 'Lenders directory (loan_lender_name kept in sync)' AFTER `loan_lender_name`;
ALTER TABLE `projects` ADD KEY `idx_projects_lender` (`lender_id`);
ALTER TABLE `projects`
  ADD CONSTRAINT `fk_projects_lender` FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS `appointments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(200) NOT NULL,
  `kind` ENUM('property_inspection','site_visit','lender_meeting','consultation','call','other') NOT NULL DEFAULT 'consultation',
  `starts_at` DATETIME NOT NULL COMMENT 'UTC',
  `ends_at` DATETIME NOT NULL COMMENT 'UTC',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles',
  `location_type` ENUM('onsite','office','phone','video') NOT NULL DEFAULT 'onsite',
  `location` VARCHAR(500) DEFAULT NULL,
  `video_url` VARCHAR(500) DEFAULT NULL,
  `description` TEXT DEFAULT NULL COMMENT 'Shared with attendees',
  `notes` TEXT DEFAULT NULL COMMENT 'Internal (staff only)',
  `client_id` INT UNSIGNED DEFAULT NULL,
  `lead_id` BIGINT UNSIGNED DEFAULT NULL,
  `project_id` BIGINT UNSIGNED DEFAULT NULL,
  `owner_admin_id` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('scheduled','cancelled','completed','no_show') NOT NULL DEFAULT 'scheduled',
  `source` ENUM('staff','booking') NOT NULL DEFAULT 'staff',
  `notify_homeowner` TINYINT(1) NOT NULL DEFAULT 1,
  `manage_token_hash` CHAR(64) DEFAULT NULL COMMENT 'Homeowner / booker cancel + reschedule link',
  `ics_uid` VARCHAR(120) NOT NULL,
  `ics_sequence` INT UNSIGNED NOT NULL DEFAULT 0,
  `reminder_24h_sent_at` DATETIME DEFAULT NULL,
  `reminder_1h_sent_at` DATETIME DEFAULT NULL,
  `cancelled_reason` VARCHAR(500) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_appointments_manage_token` (`manage_token_hash`),
  KEY `idx_appointments_starts` (`starts_at`),
  KEY `idx_appointments_owner_starts` (`owner_admin_id`, `starts_at`),
  KEY `idx_appointments_client` (`client_id`),
  KEY `idx_appointments_lead` (`lead_id`),
  KEY `idx_appointments_project` (`project_id`),
  KEY `idx_appointments_status` (`status`),
  CONSTRAINT `fk_appointments_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_appointments_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_appointments_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_appointments_owner` FOREIGN KEY (`owner_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_appointments_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who is tagged (gets the invite, reminders, changes).
CREATE TABLE IF NOT EXISTS `appointment_attendees` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appointment_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('admin','contractor','lender','homeowner','guest') NOT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `contractor_id` INT UNSIGNED DEFAULT NULL,
  `lender_id` INT UNSIGNED DEFAULT NULL,
  `name` VARCHAR(200) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `notified_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_appt_attendees_appt` (`appointment_id`),
  KEY `idx_appt_attendees_contractor` (`contractor_id`),
  KEY `idx_appt_attendees_admin` (`admin_id`),
  KEY `idx_appt_attendees_lender` (`lender_id`),
  CONSTRAINT `fk_appt_attendees_appt` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_appt_attendees_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_appt_attendees_contractor` FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_appt_attendees_lender` FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-staff public booking link (like real-state's scheduler).
CREATE TABLE IF NOT EXISTS `scheduler_settings` (
  `admin_id` INT UNSIGNED NOT NULL,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `slug` VARCHAR(80) NOT NULL,
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
  `allow_onsite` TINYINT(1) NOT NULL DEFAULT 1,
  `video_url` VARCHAR(500) DEFAULT NULL COMMENT 'Default video room for video bookings',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_id`),
  UNIQUE KEY `uq_scheduler_settings_slug` (`slug`),
  CONSTRAINT `fk_scheduler_settings_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `scheduler_availability` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `day_of_week` TINYINT UNSIGNED NOT NULL COMMENT '0=Sunday … 6=Saturday',
  `start_time` TIME NOT NULL,
  `end_time` TIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_scheduler_availability_admin` (`admin_id`, `day_of_week`),
  CONSTRAINT `fk_scheduler_availability_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `scheduler_blocked_ranges` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `starts_at` DATETIME NOT NULL COMMENT 'UTC',
  `ends_at` DATETIME NOT NULL COMMENT 'UTC',
  `label` VARCHAR(200) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scheduler_blocked_admin` (`admin_id`, `starts_at`),
  CONSTRAINT `fk_scheduler_blocked_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

