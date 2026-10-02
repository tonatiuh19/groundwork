-- Groundwork Capital — schema source of truth (TiDB Cloud / MySQL 8)
-- Always check this file before writing SQL. Schema changes go through migrations/.
-- Portal foundation: admin / affiliate / contractor / client (independent OTP + sessions)

CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `role` ENUM('super_admin','admin','agent','finance','content') NOT NULL DEFAULT 'admin',
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

CREATE TABLE IF NOT EXISTS `marketing_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(80) NOT NULL,
  `status` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  `is_featured` TINYINT(1) NOT NULL DEFAULT 0,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME DEFAULT NULL,
  `registration_opens_at` DATETIME DEFAULT NULL,
  `registration_closes_at` DATETIME DEFAULT NULL,
  `capacity` INT UNSIGNED DEFAULT NULL,
  `waitlist_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `city` VARCHAR(100) NOT NULL,
  `venue_name` VARCHAR(200) DEFAULT NULL,
  `venue_address` VARCHAR(500) DEFAULT NULL,
  `zoom_url` VARCHAR(500) DEFAULT NULL,
  `image_url` VARCHAR(500) DEFAULT NULL,
  `title_en` VARCHAR(200) NOT NULL,
  `title_es` VARCHAR(200) NOT NULL,
  `summary_en` VARCHAR(500) DEFAULT NULL,
  `summary_es` VARCHAR(500) DEFAULT NULL,
  `body_en` TEXT DEFAULT NULL,
  `body_es` TEXT DEFAULT NULL,
  `location_label_en` VARCHAR(200) DEFAULT NULL,
  `location_label_es` VARCHAR(200) DEFAULT NULL,
  `cta_en` VARCHAR(120) DEFAULT NULL,
  `cta_es` VARCHAR(120) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_marketing_events_slug` (`slug`),
  KEY `idx_marketing_events_status_featured` (`status`, `is_featured`),
  KEY `idx_marketing_events_starts` (`starts_at`),
  CONSTRAINT `fk_marketing_events_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `leads` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `first_name` VARCHAR(100) DEFAULT NULL,
  `last_name` VARCHAR(100) DEFAULT NULL,
  `full_name` VARCHAR(200) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(40) NOT NULL,
  `property_address` VARCHAR(500) DEFAULT NULL,
  `soft_pull_consent` TINYINT(1) NOT NULL DEFAULT 0,
  `mode` ENUM('event','standard') NOT NULL DEFAULT 'standard',
  `event_city` VARCHAR(100) DEFAULT NULL,
  `event_id` INT UNSIGNED DEFAULT NULL,
  `event_registration_status` ENUM('confirmed','waitlisted') DEFAULT NULL,
  `source` VARCHAR(100) DEFAULT NULL,
  `affiliate_id` INT UNSIGNED DEFAULT NULL,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `referral_code` VARCHAR(32) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `notes` TEXT DEFAULT NULL,
  `status` ENUM('new','contacted','qualified','closed','spam') NOT NULL DEFAULT 'new',
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_leads_email` (`email`),
  KEY `idx_leads_status` (`status`),
  KEY `idx_leads_created` (`created_at`),
  KEY `idx_leads_source` (`source`),
  KEY `idx_leads_affiliate` (`affiliate_id`),
  KEY `idx_leads_event` (`event_id`),
  KEY `idx_leads_mode` (`mode`),
  UNIQUE KEY `uq_leads_email_event` (`email`, `event_id`),
  CONSTRAINT `fk_leads_event`
    FOREIGN KEY (`event_id`) REFERENCES `marketing_events`(`id`) ON DELETE SET NULL
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

CREATE TABLE IF NOT EXISTS `admin_otp_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('login','email_verify') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_otp_admin_id` (`admin_id`),
  KEY `idx_admin_otp_expires` (`expires_at`),
  CONSTRAINT `fk_admin_otp_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admin_sessions_token` (`token_hash`),
  KEY `idx_admin_sessions_admin` (`admin_id`),
  KEY `idx_admin_sessions_active` (`is_active`),
  KEY `idx_admin_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_admin_sessions_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2) Affiliates (independent identity — not linked to admins)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `affiliates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `company` VARCHAR(200) DEFAULT NULL,
  `status` ENUM('pending','active','inactive','suspended') NOT NULL DEFAULT 'pending',
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `referral_code` VARCHAR(32) NOT NULL,
  `slug` VARCHAR(64) DEFAULT NULL,
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `bio` TEXT DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `approved_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_affiliates_email` (`email`),
  UNIQUE KEY `uq_affiliates_referral` (`referral_code`),
  UNIQUE KEY `uq_affiliates_slug` (`slug`),
  KEY `idx_affiliates_status` (`status`),
  CONSTRAINT `fk_affiliates_approver`
    FOREIGN KEY (`approved_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_otp_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('login','email_verify','signup') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aff_otp_affiliate` (`affiliate_id`),
  KEY `idx_aff_otp_expires` (`expires_at`),
  CONSTRAINT `fk_aff_otp_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aff_sessions_token` (`token_hash`),
  KEY `idx_aff_sessions_affiliate` (`affiliate_id`),
  KEY `idx_aff_sessions_active` (`is_active`),
  KEY `idx_aff_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_aff_sessions_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_invite_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(64) NOT NULL,
  `slug` VARCHAR(64) DEFAULT NULL,
  `kind` ENUM('evergreen','one_time') NOT NULL DEFAULT 'evergreen',
  `label` VARCHAR(120) DEFAULT NULL,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `max_uses` INT UNSIGNED DEFAULT NULL,
  `use_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `expires_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED NOT NULL,
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aff_invite_token` (`token`),
  UNIQUE KEY `uq_aff_invite_slug` (`slug`),
  KEY `idx_aff_invite_enabled` (`is_enabled`),
  CONSTRAINT `fk_aff_invite_creator`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_link_clicks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `landing` VARCHAR(80) NOT NULL DEFAULT 'home',
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `referer` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aff_clicks_affiliate` (`affiliate_id`),
  KEY `idx_aff_clicks_created` (`created_at`),
  CONSTRAINT `fk_aff_clicks_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3) Contractors (invite-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `contractors` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `company` VARCHAR(200) DEFAULT NULL,
  `license_number` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('invited','active','inactive','suspended') NOT NULL DEFAULT 'invited',
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `invited_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `activated_at` DATETIME DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contractors_email` (`email`),
  KEY `idx_contractors_status` (`status`),
  CONSTRAINT `fk_contractors_inviter`
    FOREIGN KEY (`invited_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractor_otp_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contractor_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('login','email_verify','invite') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contractor_otp_contractor` (`contractor_id`),
  KEY `idx_contractor_otp_expires` (`expires_at`),
  CONSTRAINT `fk_contractor_otp_contractor`
    FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractor_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contractor_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contractor_sessions_token` (`token_hash`),
  KEY `idx_contractor_sessions_contractor` (`contractor_id`),
  KEY `idx_contractor_sessions_active` (`is_active`),
  KEY `idx_contractor_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_contractor_sessions_contractor`
    FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractor_invites` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(64) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `contractor_id` INT UNSIGNED DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `accepted_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contractor_invite_token` (`token`),
  KEY `idx_contractor_invite_email` (`email`),
  CONSTRAINT `fk_contractor_invite_contractor`
    FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_contractor_invite_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4) Clients / homeowners (portal identity)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `status` ENUM('prospect','active','inactive','suspended') NOT NULL DEFAULT 'prospect',
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `state` VARCHAR(50) DEFAULT NULL,
  `zip` VARCHAR(20) DEFAULT NULL,
  `affiliate_id` INT UNSIGNED DEFAULT NULL,
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `lead_id` BIGINT UNSIGNED DEFAULT NULL,
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `admin_notes` TEXT DEFAULT NULL,
  `email_verified_at` DATETIME DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clients_email` (`email`),
  KEY `idx_clients_status` (`status`),
  KEY `idx_clients_affiliate` (`affiliate_id`),
  KEY `idx_clients_admin` (`assigned_admin_id`),
  KEY `idx_clients_lead` (`lead_id`),
  CONSTRAINT `fk_clients_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clients_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clients_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_otp_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('login','email_verify') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client_otp_client` (`client_id`),
  KEY `idx_client_otp_expires` (`expires_at`),
  CONSTRAINT `fk_client_otp_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_sessions_token` (`token_hash`),
  KEY `idx_client_sessions_client` (`client_id`),
  KEY `idx_client_sessions_active` (`is_active`),
  KEY `idx_client_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_client_sessions_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- ---------------------------------------------------------------------------
-- 5) ADU plans + projects (deals)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `adu_plans` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `bedrooms` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `bathrooms` DECIMAL(3,1) NOT NULL DEFAULT 1.0,
  `stories` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `sq_ft` INT UNSIGNED NOT NULL,
  `default_commission_cents` INT UNSIGNED NOT NULL
    COMMENT 'Default affiliate commission = $10/sqft',
  `layout_image_url` VARCHAR(500) DEFAULT NULL,
  `exterior_image_url` VARCHAR(500) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_adu_plans_code` (`code`),
  KEY `idx_adu_plans_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `adu_plans`
  (`code`,`name`,`bedrooms`,`bathrooms`,`stories`,`sq_ft`,`default_commission_cents`,`layout_image_url`,`exterior_image_url`,`description`,`sort_order`)
VALUES
  ('fontana-1br','Fontana 1 Bed / 1 Bath',1,1.0,1,550,550000,'/adu/plan-1.png','/adu/design-viz-1.jpg','Simple ADU layout',1),
  ('fontana-2story','Fontana 2 Story / 2 Bed / 2 Bath',2,2.0,2,750,750000,'/adu/plan-2.png','/adu/design-viz-3.jpg','Simple two-story ADU layout',2),
  ('fontana-expanded','Fontana Expanded 6 Bed / 3 Bath',6,3.0,1,1050,1050000,'/adu/plan-3.png','/adu/design-viz-2.jpg','Expanded ADU layout',3)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `sq_ft` = VALUES(`sq_ft`),
  `default_commission_cents` = VALUES(`default_commission_cents`);

CREATE TABLE IF NOT EXISTS `projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` VARCHAR(24) NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `lead_id` BIGINT UNSIGNED DEFAULT NULL,
  `affiliate_id` INT UNSIGNED DEFAULT NULL,
  `contractor_id` INT UNSIGNED DEFAULT NULL,
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `adu_plan_id` INT UNSIGNED DEFAULT NULL,
  `milestone` ENUM(
    'lead','financing','contracted','in_build','closed','cancelled'
  ) NOT NULL DEFAULT 'lead',
  `milestone_changed_at` DATETIME DEFAULT NULL,
  `property_address` VARCHAR(500) DEFAULT NULL,
  `property_city` VARCHAR(100) DEFAULT NULL,
  `property_state` VARCHAR(50) DEFAULT NULL,
  `property_zip` VARCHAR(20) DEFAULT NULL,
  `sq_ft` INT UNSIGNED DEFAULT NULL,
  `sale_price_cents` BIGINT UNSIGNED DEFAULT NULL,
  `contractor_cost_cents` BIGINT UNSIGNED DEFAULT NULL,
  `draw_committed_cents` BIGINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Sum of draft+submitted+approved+paid draw amounts',
  `affiliate_commission_cents` INT UNSIGNED DEFAULT NULL,
  `agent_commission_cents` INT UNSIGNED DEFAULT NULL,
  `net_profit_cents` BIGINT DEFAULT NULL,
  `net_profit_per_sqft_cents` INT DEFAULT NULL,
  `loan_lender_type` ENUM('anchor','external','unknown') NOT NULL DEFAULT 'unknown',
  `loan_lender_name` VARCHAR(200) DEFAULT NULL,
  `loan_status` ENUM(
    'not_started','in_process','underwriting','approved','finalized','denied','withdrawn'
  ) NOT NULL DEFAULT 'not_started',
  `loan_finalized_at` DATETIME DEFAULT NULL,
  `anchor_external_id` VARCHAR(120) DEFAULT NULL,
  `anchor_last_synced_at` DATETIME DEFAULT NULL,
  `commission_override_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Admin override; NULL = use plan default / $10 sqft',
  `commission_expected_pay_at` DATE DEFAULT NULL,
  `commission_paid_at` DATETIME DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_projects_public_id` (`public_id`),
  KEY `idx_projects_client` (`client_id`),
  KEY `idx_projects_affiliate` (`affiliate_id`),
  KEY `idx_projects_contractor` (`contractor_id`),
  KEY `idx_projects_milestone` (`milestone`),
  KEY `idx_projects_loan_status` (`loan_status`),
  KEY `idx_projects_anchor` (`anchor_external_id`),
  CONSTRAINT `fk_projects_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_projects_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_contractor`
    FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_plan`
    FOREIGN KEY (`adu_plan_id`) REFERENCES `adu_plans`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `project_milestone_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `from_milestone` VARCHAR(40) DEFAULT NULL,
  `to_milestone` VARCHAR(40) NOT NULL,
  `changed_by_type` ENUM('admin','affiliate','contractor','client','system') NOT NULL DEFAULT 'system',
  `changed_by_id` INT UNSIGNED DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pme_project` (`project_id`),
  CONSTRAINT `fk_pme_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `project_photos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `uploaded_by_contractor_id` INT UNSIGNED DEFAULT NULL,
  `uploaded_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `storage_url` VARCHAR(1000) NOT NULL,
  `caption` VARCHAR(300) DEFAULT NULL,
  `taken_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_photos_project` (`project_id`),
  CONSTRAINT `fk_project_photos_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_photos_contractor`
    FOREIGN KEY (`uploaded_by_contractor_id`) REFERENCES `contractors`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_project_photos_admin`
    FOREIGN KEY (`uploaded_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `draw_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `contractor_id` INT UNSIGNED NOT NULL,
  `amount_cents` INT UNSIGNED NOT NULL,
  `status` ENUM('draft','submitted','approved','rejected','paid') NOT NULL DEFAULT 'draft',
  `note` TEXT DEFAULT NULL,
  `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_draws_project` (`project_id`),
  KEY `idx_draws_contractor` (`contractor_id`),
  KEY `idx_draws_status` (`status`),
  CONSTRAINT `fk_draws_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_draws_contractor`
    FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_draws_admin`
    FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_commissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `amount_cents` INT NOT NULL,
  `sq_ft` INT UNSIGNED DEFAULT NULL,
  `rate_cents_per_sqft` INT UNSIGNED DEFAULT NULL COMMENT 'Typically 1000 = $10',
  `status` ENUM('pending','approved','paid','void') NOT NULL DEFAULT 'pending',
  `expected_pay_at` DATE DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `notes` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aff_comm_project` (`project_id`, `affiliate_id`),
  KEY `idx_aff_comm_affiliate` (`affiliate_id`),
  KEY `idx_aff_comm_status` (`status`),
  CONSTRAINT `fk_aff_comm_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aff_comm_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aff_comm_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_aff_comm_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6) Contracts (PDF stub — generate later)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `project_contracts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `kind` ENUM('contractor_client','affiliate_terms','other') NOT NULL DEFAULT 'contractor_client',
  `status` ENUM('draft','generated','sent','signed','void') NOT NULL DEFAULT 'draft',
  `storage_url` VARCHAR(1000) DEFAULT NULL,
  `payload_json` JSON DEFAULT NULL COMMENT 'Address, plan, parties snapshot for PDF',
  `generated_at` DATETIME DEFAULT NULL,
  `signed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_contracts_project` (`project_id`),
  KEY `idx_project_contracts_status` (`status`),
  CONSTRAINT `fk_project_contracts_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('commission_payout_days_after_loan_close', '5', 'Days after loan finalize before affiliate expected pay date (default 5)'),
  ('commission_cents_per_sqft', '1000', 'Default affiliate commission in cents per sq ft ($10)'),
  ('portal_session_days', '30', 'Portal session lifetime in days')
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`);

-- ---------------------------------------------------------------------------
-- 7) MCP OAuth (super_admin Cursor / Claude connectors)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mcp_oauth_clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` VARCHAR(128) NOT NULL,
  `client_secret_hash` VARCHAR(255) DEFAULT NULL COMMENT 'NULL = public client (PKCE)',
  `client_name` VARCHAR(255) DEFAULT NULL,
  `redirect_uris_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mcp_client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mcp_oauth_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_hash` VARCHAR(255) NOT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `redirect_uri` VARCHAR(1000) NOT NULL,
  `code_challenge` VARCHAR(255) NOT NULL,
  `code_challenge_method` VARCHAR(16) NOT NULL DEFAULT 'S256',
  `scopes` VARCHAR(255) NOT NULL DEFAULT 'groundwork.admin.read',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mcp_code_hash` (`code_hash`),
  KEY `idx_mcp_codes_admin` (`admin_id`),
  KEY `idx_mcp_codes_expires` (`expires_at`),
  CONSTRAINT `fk_mcp_codes_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mcp_oauth_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash` VARCHAR(255) NOT NULL,
  `refresh_token_hash` VARCHAR(255) DEFAULT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `client_name` VARCHAR(255) DEFAULT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `scopes` VARCHAR(255) NOT NULL DEFAULT 'groundwork.admin.read',
  `expires_at` DATETIME NOT NULL,
  `refresh_expires_at` DATETIME DEFAULT NULL
    COMMENT 'Refresh token expiry; NULL = legacy row treated as expired on refresh',
  `revoked_at` DATETIME DEFAULT NULL,
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mcp_token_hash` (`token_hash`),
  UNIQUE KEY `uq_mcp_refresh_hash` (`refresh_token_hash`),
  KEY `idx_mcp_tokens_admin` (`admin_id`),
  KEY `idx_mcp_tokens_revoked` (`revoked_at`),
  KEY `idx_mcp_tokens_refresh_expires` (`refresh_expires_at`),
  CONSTRAINT `fk_mcp_tokens_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mcp_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `tool_name` VARCHAR(120) NOT NULL,
  `confirm` TINYINT(1) NOT NULL DEFAULT 0,
  `request_json` JSON DEFAULT NULL,
  `result_json` JSON DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mcp_audit_admin` (`admin_id`, `id`),
  CONSTRAINT `fk_mcp_audit_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
