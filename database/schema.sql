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
  `voice_available` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Browser softphone registered for inbound on assigned brand line',
  `call_forwarding_enabled` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Also ring personal phone on inbound voice',
  `call_forwarding_phone` VARCHAR(20) DEFAULT NULL
    COMMENT 'E.164 cell for simultaneous ring (voice)',
  `voicemail_enabled` TINYINT(1) DEFAULT NULL
    COMMENT 'NULL = inherit org default from system_settings',
  `voicemail_greeting_text` TEXT DEFAULT NULL,
  `voicemail_greeting_url` VARCHAR(500) DEFAULT NULL,
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
  `sms_marketing_consent` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'TCPA: required for campaign SMS',
  `mode` ENUM('event','standard') NOT NULL DEFAULT 'standard',
  `event_city` VARCHAR(100) DEFAULT NULL,
  `event_id` INT UNSIGNED DEFAULT NULL,
  `event_registration_status` ENUM('confirmed','waitlisted') DEFAULT NULL,
  `source` VARCHAR(100) DEFAULT NULL,
  `affiliate_id` INT UNSIGNED DEFAULT NULL,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `converted_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Set when lead converted to affiliate; FK added after contractors table',
  `converted_contractor_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Set when lead converted to contractor; FK added after contractors table',
  `referral_code` VARCHAR(32) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `notes` TEXT DEFAULT NULL,
  `status` ENUM('new','contacted','qualified','closed','spam') NOT NULL DEFAULT 'new',
  `audience_tag` VARCHAR(40) DEFAULT NULL COMMENT 'homeowner|information|affiliate_lead|contractor_lead',
  `submission_count` INT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Public submissions merged into this lead (repeat forms bump it)',
  `last_submitted_at` DATETIME DEFAULT NULL
    COMMENT 'Latest merged submission; list sorts by COALESCE(last_submitted_at, created_at)',
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
  KEY `idx_leads_converted_affiliate` (`converted_affiliate_id`),
  KEY `idx_leads_converted_contractor` (`converted_contractor_id`),
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

-- Ledger for `npm run db:migrate` (scripts/apply-migrations.sh)
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `filename` VARCHAR(255) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`filename`)
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
  `sms_marketing_consent` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'TCPA: required for campaign SMS',
  `referral_code` VARCHAR(32) NOT NULL,
  `slug` VARCHAR(64) DEFAULT NULL
    COMMENT 'Vanity /r/{slug}; defaults to firstname-lastname (+ -2…) on create',
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `bio` TEXT DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `approved_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `parent_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Immediate parent affiliate; NULL = top-level Affiliate',
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_affiliates_email` (`email`),
  UNIQUE KEY `uq_affiliates_referral` (`referral_code`),
  UNIQUE KEY `uq_affiliates_slug` (`slug`),
  KEY `idx_affiliates_status` (`status`),
  KEY `idx_affiliates_parent` (`parent_affiliate_id`),
  CONSTRAINT `fk_affiliates_approver`
    FOREIGN KEY (`approved_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_affiliates_parent`
    FOREIGN KEY (`parent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL
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
-- 3) Contractors (staff invite or public signup → pending until approved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `contractors` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `company` VARCHAR(200) DEFAULT NULL,
  `license_number` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('pending','invited','active','inactive','suspended') NOT NULL DEFAULT 'invited',
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `sms_marketing_consent` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'TCPA: required for campaign SMS',
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

-- Lead convert FKs (leads is created before affiliates/contractors above).
ALTER TABLE `leads`
  ADD CONSTRAINT `fk_leads_converted_affiliate`
    FOREIGN KEY (`converted_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL;
ALTER TABLE `leads`
  ADD CONSTRAINT `fk_leads_converted_contractor`
    FOREIGN KEY (`converted_contractor_id`) REFERENCES `contractors`(`id`) ON DELETE SET NULL;

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
-- 3b) Contractor prequalification application (wizard + private doc vault)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `contractor_applications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contractor_id` INT UNSIGNED NOT NULL,
  `application_number` VARCHAR(24) NOT NULL COMMENT 'CPQ-YYYY-XXXXXX',
  `status` ENUM('draft','submitted','in_review','needs_info','approved','denied') NOT NULL DEFAULT 'draft',
  `current_step` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `data_json` JSON DEFAULT NULL COMMENT 'Sections 1-9 (shared/contractorApplication.ts)',
  `legal_business_name` VARCHAR(200) DEFAULT NULL,
  `cslb_license_number` VARCHAR(40) DEFAULT NULL,
  `cslb_license_expires_on` DATE DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `due_at` DATETIME DEFAULT NULL COMMENT 'Existing active contractors: soft deadline (warn only)',
  `reminder_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `last_reminder_at` DATETIME DEFAULT NULL,
  `overdue_notified_at` DATETIME DEFAULT NULL,
  `info_request_note` TEXT DEFAULT NULL,
  `info_request_doc_types_json` JSON DEFAULT NULL,
  `signer_name` VARCHAR(200) DEFAULT NULL,
  `signer_title` VARCHAR(120) DEFAULT NULL,
  `signer_email` VARCHAR(255) DEFAULT NULL,
  `signer_phone` VARCHAR(40) DEFAULT NULL,
  `signature_image` MEDIUMTEXT DEFAULT NULL COMMENT 'PNG data URL from signature pad',
  `signed_at` DATETIME DEFAULT NULL,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `certification_version` VARCHAR(20) DEFAULT NULL,
  `certification_sha256` CHAR(64) DEFAULT NULL,
  `submitted_at` DATETIME DEFAULT NULL,
  `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `license_verified` TINYINT(1) DEFAULT NULL,
  `insurance_verified` TINYINT(1) DEFAULT NULL,
  `decision_notes` TEXT DEFAULT NULL,
  `decided_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cpq_contractor` (`contractor_id`),
  UNIQUE KEY `uq_cpq_number` (`application_number`),
  KEY `idx_cpq_status` (`status`),
  KEY `idx_cpq_due` (`due_at`),
  KEY `idx_cpq_license_exp` (`cslb_license_expires_on`),
  CONSTRAINT `fk_cpq_contractor`
    FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cpq_reviewer`
    FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cpq_creator`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Magic links (hashed). Several may be live so a reminder never kills an open tab.
CREATE TABLE IF NOT EXISTS `contractor_application_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `application_id` INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cpq_token_hash` (`token_hash`),
  KEY `idx_cpq_token_app` (`application_id`),
  KEY `idx_cpq_token_expires` (`expires_at`),
  CONSTRAINT `fk_cpq_token_app`
    FOREIGN KEY (`application_id`) REFERENCES `contractor_applications`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uploaded documents live in a PRIVATE Vercel Blob store; served only via the API.
CREATE TABLE IF NOT EXISTS `contractor_application_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `application_id` INT UNSIGNED NOT NULL,
  `doc_type` VARCHAR(40) NOT NULL,
  `blob_pathname` VARCHAR(500) NOT NULL,
  `blob_url` VARCHAR(1000) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size_bytes` INT UNSIGNED NOT NULL,
  `expires_on` DATE DEFAULT NULL,
  `status` ENUM('uploaded','accepted','rejected') NOT NULL DEFAULT 'uploaded',
  `review_note` VARCHAR(500) DEFAULT NULL,
  `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `expiry_reminded_days` SMALLINT DEFAULT NULL COMMENT 'Last expiry reminder threshold sent (30/7/0)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cpq_doc_pathname` (`blob_pathname`),
  KEY `idx_cpq_doc_app_type` (`application_id`, `doc_type`),
  KEY `idx_cpq_doc_expires` (`expires_on`),
  CONSTRAINT `fk_cpq_doc_app`
    FOREIGN KEY (`application_id`) REFERENCES `contractor_applications`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cpq_doc_reviewer`
    FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit trail (sent, opened, submitted, info requested, decisions, overrides, reminders).
CREATE TABLE IF NOT EXISTS `contractor_application_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `application_id` INT UNSIGNED NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `actor_type` ENUM('admin','contractor','system') NOT NULL DEFAULT 'system',
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `note` VARCHAR(1000) DEFAULT NULL,
  `meta_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cpq_events_app` (`application_id`, `created_at`),
  CONSTRAINT `fk_cpq_events_app`
    FOREIGN KEY (`application_id`) REFERENCES `contractor_applications`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cpq_events_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3c) People de-duplication audit (one role per person; email OR phone)
-- ---------------------------------------------------------------------------
-- Audit trail for merges, deletes, phone overrides, links and dismissals.
CREATE TABLE IF NOT EXISTS `people_dedupe_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `action` ENUM('merge','delete','phone_override','link','dismiss','blocked') NOT NULL,
  `entity` ENUM('lead','client','affiliate','contractor') NOT NULL,
  `record_id` BIGINT UNSIGNED DEFAULT NULL,
  `target_entity` ENUM('lead','client','affiliate','contractor') DEFAULT NULL,
  `target_id` BIGINT UNSIGNED DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `snapshot_json` JSON DEFAULT NULL COMMENT 'Removed record + moved reference counts',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dedupe_log_record` (`entity`, `record_id`),
  KEY `idx_dedupe_log_created` (`created_at`),
  CONSTRAINT `fk_dedupe_log_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Not duplicates" decisions (e.g. a household sharing one phone). Signature =
-- sorted member keys of the cluster ("client:12|client:40"); a new member
-- changes the signature, so the cluster resurfaces for review.
CREATE TABLE IF NOT EXISTS `people_dedupe_dismissals` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `signature` VARCHAR(500) NOT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dedupe_dismissal_sig` (`signature`),
  CONSTRAINT `fk_dedupe_dismissal_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4) Clients / homeowners (portal identity)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) DEFAULT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `status` ENUM('pending','prospect','active','inactive','suspended') NOT NULL DEFAULT 'prospect',
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
  ('fontana-1br','The Haven',1,1.0,1,445,550000,'/adu/plan-3d-3.jpg','/adu/design-viz-3.jpg','Compact Living, Thoughtfully Designed',1),
  ('fontana-2story','The Veranda',2,1.0,1,474,750000,'/adu/plan-3d-1.jpg','/adu/design-viz-1.jpg','More Room. More Possibilities.',2),
  ('fontana-expanded','The Summit',2,2.0,2,830,1050000,'/adu/plan-3d-2.jpg','/adu/design-viz-2.jpg','Elevated Two-Story Living',3)
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
  `closer_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Affiliate who brought the client (payee closer/direct)',
  `parent_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen parent at enrollment when closer is a sub',
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
    COMMENT 'Admin override; NULL = use sq ft × frozen/settings rates',
  `commission_rate_direct_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen direct $/sqft cents at accrual',
  `commission_rate_closer_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen closer $/sqft cents at accrual',
  `commission_rate_parent_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen parent $/sqft cents at accrual',
  `commission_expected_pay_at` DATE DEFAULT NULL,
  `commission_paid_at` DATETIME DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_projects_public_id` (`public_id`),
  KEY `idx_projects_client` (`client_id`),
  KEY `idx_projects_affiliate` (`affiliate_id`),
  KEY `idx_projects_closer` (`closer_affiliate_id`),
  KEY `idx_projects_parent_aff` (`parent_affiliate_id`),
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
  CONSTRAINT `fk_projects_closer`
    FOREIGN KEY (`closer_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_parent_aff`
    FOREIGN KEY (`parent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
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
  `role` ENUM('direct','closer','parent') NOT NULL DEFAULT 'direct'
    COMMENT 'direct = full rate; closer = sub share; parent = override share',
  `project_id` BIGINT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `amount_cents` INT NOT NULL,
  `sq_ft` INT UNSIGNED DEFAULT NULL,
  `rate_cents_per_sqft` INT UNSIGNED DEFAULT NULL COMMENT 'Snapshot cents per sq ft for this row',
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
  KEY `idx_aff_comm_role` (`role`),
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
  ('commission_cents_per_sqft', '1000', 'Legacy alias of commission_direct_cents_per_sqft ($/sqft cents)'),
  ('commission_direct_cents_per_sqft', '1000', 'Affiliate direct commission $/sqft in cents ($10) when no sub in chain'),
  ('commission_closer_cents_per_sqft', '700', 'Sub-affiliate (closer) share $/sqft in cents ($7)'),
  ('commission_parent_cents_per_sqft', '300', 'Parent affiliate override $/sqft in cents ($3) when sub closes'),
  ('portal_session_days', '30', 'Portal session lifetime in days'),
  ('cpq_template_master_contractor_agreement', NULL, 'Prequalification: blank Master Contractor Agreement PDF URL (contractor signs + uploads)'),
  ('cpq_template_background_check_authorization', NULL, 'Prequalification: blank Background Check Authorization PDF URL')
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

-- Conversations Contact Hub (SMS / CRM / brand Twilio lines)
CREATE TABLE IF NOT EXISTS `admin_phone_numbers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `e164` VARCHAR(20) NOT NULL COMMENT 'E.164 e.g. +15625735110',
  `friendly_name` VARCHAR(120) DEFAULT NULL,
  `twilio_sid` VARCHAR(64) DEFAULT NULL,
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `capabilities_json` JSON DEFAULT NULL COMMENT '{"sms":true,"mms":true,"voice":true}',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_phone_e164` (`e164`),
  KEY `idx_admin_phone_assigned` (`assigned_admin_id`),
  CONSTRAINT `fk_admin_phone_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contacts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `state` VARCHAR(50) DEFAULT NULL,
  `zip` VARCHAR(20) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `admin_notes` TEXT DEFAULT NULL,
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `converted_client_id` INT UNSIGNED DEFAULT NULL,
  `converted_at` DATETIME DEFAULT NULL,
  `deleted_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contacts_email` (`email`),
  KEY `idx_contacts_phone` (`phone`),
  KEY `idx_contacts_deleted` (`deleted_at`),
  KEY `idx_contacts_converted` (`converted_client_id`),
  KEY `idx_contacts_created` (`created_at`),
  KEY `idx_contacts_assigned` (`assigned_admin_id`),
  CONSTRAINT `fk_contacts_assigned_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_contacts_created_by`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_contacts_converted_client`
    FOREIGN KEY (`converted_client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversation_unknown_contacts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone_e164` VARCHAR(20) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `display_name` VARCHAR(200) DEFAULT NULL,
  `ofg_number_id` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('open','linked','dismissed') NOT NULL DEFAULT 'open',
  `linked_client_id` INT UNSIGNED DEFAULT NULL,
  `linked_contact_id` INT UNSIGNED DEFAULT NULL,
  `last_message_at` DATETIME DEFAULT NULL,
  `last_message_preview` VARCHAR(500) DEFAULT NULL,
  `unread_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_unknown_phone` (`phone_e164`),
  KEY `idx_unknown_status` (`status`),
  KEY `idx_unknown_number` (`ofg_number_id`),
  CONSTRAINT `fk_unknown_ofg_number`
    FOREIGN KEY (`ofg_number_id`) REFERENCES `admin_phone_numbers`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_unknown_linked_client`
    FOREIGN KEY (`linked_client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_unknown_linked_contact`
    FOREIGN KEY (`linked_contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED DEFAULT NULL,
  `channel` ENUM('sms','call','email','internal') NOT NULL DEFAULT 'sms',
  `last_message_at` DATETIME DEFAULT NULL,
  `last_message_preview` VARCHAR(500) DEFAULT NULL,
  `unread_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `assigned_admin_id` INT UNSIGNED DEFAULT NULL,
  `ofg_number_id` INT UNSIGNED DEFAULT NULL COMMENT 'Brand Twilio line (Groundwork number)',
  `unknown_contact_id` INT UNSIGNED DEFAULT NULL,
  `contact_id` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('open','snoozed','closed','archived') NOT NULL DEFAULT 'open',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conversations_client` (`client_id`),
  KEY `idx_conversations_assigned` (`assigned_admin_id`),
  KEY `idx_conversations_status` (`status`),
  KEY `idx_conversations_ofg_number` (`ofg_number_id`),
  KEY `idx_conversations_unknown` (`unknown_contact_id`),
  KEY `idx_conversations_contact` (`contact_id`),
  KEY `idx_conversations_last_msg` (`last_message_at`),
  CONSTRAINT `fk_conversations_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_conversations_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_conversations_ofg_number`
    FOREIGN KEY (`ofg_number_id`) REFERENCES `admin_phone_numbers`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_conversations_unknown`
    FOREIGN KEY (`unknown_contact_id`) REFERENCES `conversation_unknown_contacts`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_conversations_contact`
    FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversation_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` INT UNSIGNED NOT NULL,
  `direction` ENUM('inbound','outbound','internal','system') NOT NULL,
  `channel` ENUM('sms','call','email','internal') NOT NULL DEFAULT 'sms',
  `body` MEDIUMTEXT DEFAULT NULL,
  `media_url` VARCHAR(1000) DEFAULT NULL,
  `media_content_type` VARCHAR(120) DEFAULT NULL,
  `from_address` VARCHAR(255) DEFAULT NULL,
  `to_address` VARCHAR(255) DEFAULT NULL,
  `provider_message_id` VARCHAR(255) DEFAULT NULL,
  `provider_status` VARCHAR(50) DEFAULT NULL,
  `call_duration_sec` INT UNSIGNED DEFAULT NULL,
  `recording_url` VARCHAR(500) DEFAULT NULL,
  `sent_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `metadata_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_messages_conversation` (`conversation_id`),
  KEY `idx_messages_created` (`created_at`),
  KEY `idx_messages_provider` (`provider_message_id`),
  CONSTRAINT `fk_messages_conversation`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_messages_admin`
    FOREIGN KEY (`sent_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mms_media` (
  `id` CHAR(36) NOT NULL,
  `content_type` VARCHAR(120) NOT NULL,
  `filename` VARCHAR(255) DEFAULT NULL,
  `data` MEDIUMBLOB NULL,
  `cdn_url` VARCHAR(1000) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mms_media_expires` (`expires_at`),
  CONSTRAINT `fk_mms_media_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversation_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(120) NOT NULL,
  `body_en` TEXT NOT NULL,
  `body_es` TEXT DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conv_templates_active` (`is_active`, `sort_order`),
  CONSTRAINT `fk_conv_templates_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Campaigns (Resend Broadcasts + Twilio SMS, consent-gated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `campaigns` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(200) NOT NULL,
  `audience_kind` ENUM('leads','affiliates','contractors') NOT NULL DEFAULT 'leads',
  `audience_filter_json` JSON NOT NULL,
  `channels_json` JSON NOT NULL COMMENT '{"email":true,"sms":true}',
  `status` ENUM('draft','scheduled','sending','sent','cancelled','failed') NOT NULL DEFAULT 'draft',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `scheduled_at` DATETIME DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `resend_segment_id_en` VARCHAR(64) DEFAULT NULL,
  `resend_segment_id_es` VARCHAR(64) DEFAULT NULL,
  `resend_broadcast_id_en` VARCHAR(64) DEFAULT NULL,
  `resend_broadcast_id_es` VARCHAR(64) DEFAULT NULL,
  `stats_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_campaigns_status` (`status`),
  KEY `idx_campaigns_kind` (`audience_kind`),
  KEY `idx_campaigns_created` (`created_at`),
  CONSTRAINT `fk_campaigns_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `campaign_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `campaign_id` INT UNSIGNED NOT NULL,
  `role` ENUM('opener','reply_1','reply_2','reply_3','reply_4') NOT NULL,
  `subject_en` VARCHAR(255) DEFAULT NULL,
  `subject_es` VARCHAR(255) DEFAULT NULL,
  `email_html_en` MEDIUMTEXT DEFAULT NULL,
  `email_html_es` MEDIUMTEXT DEFAULT NULL,
  `sms_body_en` VARCHAR(1600) DEFAULT NULL,
  `sms_body_es` VARCHAR(1600) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_template_role` (`campaign_id`, `role`),
  CONSTRAINT `fk_campaign_templates_campaign`
    FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `campaign_send_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `campaign_id` INT UNSIGNED NOT NULL,
  `recipient_kind` ENUM('leads','affiliates','contractors') NOT NULL,
  `recipient_id` BIGINT UNSIGNED NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `channel` ENUM('email','sms') NOT NULL,
  `lang` ENUM('en','es') NOT NULL DEFAULT 'en',
  `status` ENUM(
    'queued','sent','skipped_no_consent','skipped_no_contact','failed','dry_run'
  ) NOT NULL,
  `provider_id` VARCHAR(64) DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_campaign_logs_campaign` (`campaign_id`),
  KEY `idx_campaign_logs_recipient` (`recipient_kind`, `recipient_id`),
  KEY `idx_campaign_logs_status` (`status`),
  CONSTRAINT `fk_campaign_logs_campaign`
    FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `campaign_recipient_state` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `campaign_id` INT UNSIGNED NOT NULL,
  `recipient_kind` ENUM('leads','affiliates','contractors') NOT NULL,
  `recipient_id` BIGINT UNSIGNED NOT NULL,
  `last_role` ENUM('opener','reply_1','reply_2','reply_3','reply_4') NOT NULL DEFAULT 'opener',
  `audience_tag` VARCHAR(40) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_recipient` (`campaign_id`, `recipient_kind`, `recipient_id`),
  KEY `idx_campaign_recipient_lookup` (`recipient_kind`, `recipient_id`),
  CONSTRAINT `fk_campaign_recipient_campaign`
    FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
