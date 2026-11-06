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
  `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'service_cities; RSVP leads inherit it',
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
  `rsvp_flow_id` INT UNSIGNED DEFAULT NULL COMMENT 'Automation (trigger event_rsvp) started on RSVP; NULL = no automatic messages',
  `qr_scan_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Scans of the /e/<slug> QR short link',
  `qr_last_scanned_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_marketing_events_slug` (`slug`),
  KEY `idx_marketing_events_status_featured` (`status`, `is_featured`),
  KEY `idx_marketing_events_starts` (`starts_at`),
  KEY `idx_marketing_events_city` (`city_id`),
  CONSTRAINT `fk_marketing_events_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
  -- fk_marketing_events_rsvp_flow → reminder_flows(id) ON DELETE SET NULL (added in 20261103_170000_event_rsvp_flow.sql)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Past-event highlights (photos / uploaded videos / embedded reels)
CREATE TABLE IF NOT EXISTS `event_media` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('photo','video','embed') NOT NULL,
  `url` VARCHAR(1000) NOT NULL COMMENT 'Public Blob URL (photo/video) or normalized embed URL',
  `source_url` VARCHAR(1000) DEFAULT NULL COMMENT 'Original pasted link for embeds',
  `embed_provider` ENUM('instagram','youtube','tiktok') DEFAULT NULL,
  `blob_pathname` VARCHAR(500) DEFAULT NULL,
  `mime_type` VARCHAR(100) DEFAULT NULL,
  `size_bytes` BIGINT UNSIGNED DEFAULT NULL,
  `caption_en` VARCHAR(300) DEFAULT NULL,
  `caption_es` VARCHAR(300) DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_cover` TINYINT(1) NOT NULL DEFAULT 0,
  `is_highlight` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_event_media_event` (`event_id`, `sort_order`),
  CONSTRAINT `fk_event_media_event`
    FOREIGN KEY (`event_id`) REFERENCES `marketing_events`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_event_media_admin`
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
  `assigned_contractor_id` INT UNSIGNED DEFAULT NULL COMMENT 'Scorecard Lead rep; FK added after contractors table',
  `contractor_assigned_at` DATETIME DEFAULT NULL,
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
  `role_token` CHAR(32) DEFAULT NULL COMMENT 'A/B/C prompt links + form prefill',
  `role_prompt_sent_at` DATETIME DEFAULT NULL,
  `role_answer` ENUM('homeowner','partner','contractor') DEFAULT NULL,
  `role_answered_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_leads_role_token` (`role_token`),
  KEY `idx_leads_email` (`email`),
  KEY `idx_leads_status` (`status`),
  KEY `idx_leads_created` (`created_at`),
  KEY `idx_leads_source` (`source`),
  KEY `idx_leads_affiliate` (`affiliate_id`),
  KEY `idx_leads_converted_affiliate` (`converted_affiliate_id`),
  KEY `idx_leads_converted_contractor` (`converted_contractor_id`),
  KEY `idx_leads_assigned_contractor` (`assigned_contractor_id`, `contractor_assigned_at`),
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
  `subscription_price_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Monthly platform price printed in the agreement; NULL = pending',
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `billing_customer_id` VARCHAR(64) DEFAULT NULL COMMENT 'Payment processor customer id',
  `billing_subscription_id` VARCHAR(64) DEFAULT NULL COMMENT 'Payment processor subscription id',
  `billing_payment_method_id` VARCHAR(64) DEFAULT NULL COMMENT 'Saved card (subscription starts on approval)',
  `billing_status` ENUM('none','trialing','active','past_due','canceled','incomplete') NOT NULL DEFAULT 'none',
  `billing_trial_ends_at` DATETIME DEFAULT NULL,
  `billing_current_period_end` DATETIME DEFAULT NULL,
  `billing_card_brand` VARCHAR(20) DEFAULT NULL,
  `billing_card_last4` CHAR(4) DEFAULT NULL,
  `billing_card_exp` VARCHAR(7) DEFAULT NULL COMMENT 'MM/YYYY',
  `billing_cancel_at_period_end` TINYINT(1) NOT NULL DEFAULT 0,
  `billing_updated_at` DATETIME DEFAULT NULL,
  `slug_changed_at` DATETIME DEFAULT NULL COMMENT 'Last self-service link-name change (once per 30 days)',
  `billing_price_override_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Staff override of the agreement price; NULL = agreement price, 0 = waived',
  `link_sent_at` DATETIME DEFAULT NULL COMMENT 'Last time the referral-link welcome (email + SMS) was sent',
  `billing_trial_used_at` DATETIME DEFAULT NULL COMMENT 'Free period granted (once per person)',
  `billing_trial_reminder_sent_at` DATETIME DEFAULT NULL COMMENT 'Free period ending notice sent (once per free period)',
  `billing_expiry_notice` VARCHAR(16) DEFAULT NULL COMMENT 'Last card-expiry reminder sent: MM/YYYY:30 or MM/YYYY:7',
  `partner_type` ENUM('realtor','lender','other') DEFAULT NULL,
  `license_number` VARCHAR(40) DEFAULT NULL COMMENT 'DRE # (realtor) or NMLS # (lender)',
  `lender_id` INT UNSIGNED DEFAULT NULL COMMENT 'Lenders directory entry (lender affiliates, on approval)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_affiliates_email` (`email`),
  UNIQUE KEY `uq_affiliates_referral` (`referral_code`),
  UNIQUE KEY `uq_affiliates_slug` (`slug`),
  KEY `idx_affiliates_status` (`status`),
  KEY `idx_affiliates_parent` (`parent_affiliate_id`),
  CONSTRAINT `fk_affiliates_approver`
    FOREIGN KEY (`approved_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_affiliates_parent`
    FOREIGN KEY (`parent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  KEY `idx_affiliates_billing_customer` (`billing_customer_id`),
  KEY `idx_affiliates_billing_subscription` (`billing_subscription_id`)
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
  `subscription_price_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Monthly platform price override; NULL = default setting, 0 = waived',
  `billing_customer_id` VARCHAR(64) DEFAULT NULL COMMENT 'Payment processor customer id',
  `billing_subscription_id` VARCHAR(64) DEFAULT NULL COMMENT 'Payment processor subscription id',
  `billing_payment_method_id` VARCHAR(64) DEFAULT NULL COMMENT 'Saved card (subscription starts on approval)',
  `billing_status` ENUM('none','trialing','active','past_due','canceled','incomplete') NOT NULL DEFAULT 'none',
  `billing_trial_ends_at` DATETIME DEFAULT NULL,
  `billing_current_period_end` DATETIME DEFAULT NULL,
  `billing_card_brand` VARCHAR(20) DEFAULT NULL,
  `billing_card_last4` CHAR(4) DEFAULT NULL,
  `billing_card_exp` VARCHAR(7) DEFAULT NULL COMMENT 'MM/YYYY',
  `billing_cancel_at_period_end` TINYINT(1) NOT NULL DEFAULT 0,
  `billing_updated_at` DATETIME DEFAULT NULL,
  `billing_trial_used_at` DATETIME DEFAULT NULL COMMENT 'Free period granted (once per person)',
  `billing_trial_reminder_sent_at` DATETIME DEFAULT NULL COMMENT 'Free period ending notice sent (once per free period)',
  `billing_expiry_notice` VARCHAR(16) DEFAULT NULL COMMENT 'Last card-expiry reminder sent: MM/YYYY:30 or MM/YYYY:7',
  `scorecard_roles` SET('lead_rep','coordinator') DEFAULT NULL COMMENT 'Which scorecards apply; NULL = not scored',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contractors_email` (`email`),
  KEY `idx_contractors_status` (`status`),
  KEY `idx_contractors_billing_customer` (`billing_customer_id`),
  KEY `idx_contractors_billing_subscription` (`billing_subscription_id`),
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
ALTER TABLE `leads`
  ADD CONSTRAINT `fk_leads_assigned_contractor`
    FOREIGN KEY (`assigned_contractor_id`) REFERENCES `contractors`(`id`) ON DELETE SET NULL;

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
  `action` ENUM('merge','delete','phone_override','link','dismiss','blocked','revert','email_change') NOT NULL,
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
-- Deal statuses (separate from portal account status; editable in Settings)
CREATE TABLE IF NOT EXISTS `deal_statuses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `label_en` VARCHAR(80) NOT NULL,
  `label_es` VARCHAR(80) NOT NULL,
  `tone` ENUM('neutral','warn','bad','good') NOT NULL DEFAULT 'warn',
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `deal_status_id` INT UNSIGNED DEFAULT NULL COMMENT 'Deal status (credit repair, not enough equity, …); NULL = none',
  `deal_status_changed_at` DATETIME DEFAULT NULL,
  `admin_notes` TEXT DEFAULT NULL,
  `email_verified_at` DATETIME DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `lender_id` INT UNSIGNED DEFAULT NULL COMMENT 'Homeowner lender (projects follow it unless they set their own)',
  `sms_marketing_consent` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'OK to text (automatic follow-ups)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clients_email` (`email`),
  KEY `idx_clients_status` (`status`),
  KEY `idx_clients_deal_status` (`deal_status_id`),
  KEY `idx_clients_affiliate` (`affiliate_id`),
  KEY `idx_clients_admin` (`assigned_admin_id`),
  KEY `idx_clients_lead` (`lead_id`),
  CONSTRAINT `fk_clients_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clients_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clients_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clients_deal_status`
    FOREIGN KEY (`deal_status_id`) REFERENCES `deal_statuses`(`id`) ON DELETE SET NULL
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
  `email` VARCHAR(255) DEFAULT NULL COMMENT 'NULL = phone-only homeowner (invite sent by text)',
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
  ('fontana-1br','The Haven',1,1.0,1,445,550000,'/adu/plan-3d-3.jpg','/adu/design-photo-3.jpg','Compact Living, Thoughtfully Designed',1),
  ('fontana-2story','The Veranda',2,1.0,1,474,750000,'/adu/plan-3d-1.jpg','/adu/design-photo-1.jpg','More Room. More Possibilities.',2),
  ('fontana-expanded','The Summit',2,2.0,2,830,1050000,'/adu/plan-3d-2.jpg','/adu/design-photo-2.jpg','Elevated Two-Story Living',3)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `sq_ft` = VALUES(`sq_ft`),
  `default_commission_cents` = VALUES(`default_commission_cents`);

-- Lenders directory (projects.lender_id → lenders)
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
  `nmls_number` VARCHAR(40) DEFAULT NULL,
  `affiliate_id` INT UNSIGNED DEFAULT NULL COMMENT 'Affiliate account of this lender (if any)',
  PRIMARY KEY (`id`),
  KEY `idx_lenders_active` (`is_active`),
  CONSTRAINT `fk_lenders_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `lender_id` INT UNSIGNED DEFAULT NULL COMMENT 'Lenders directory (loan_lender_name kept in sync)',
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
  `commission_rate_parent_shared_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen sponsor rate when a senior sponsor also earns',
  `commission_rate_grandparent_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen senior sponsor rate',
  `grandparent_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Senior Sponsor (sponsor''s sponsor) at project creation',
  `commission_plan` ENUM('one_level','two_level') NOT NULL DEFAULT 'two_level'
    COMMENT 'Pre-2026-10-15 projects stay one_level',
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
  KEY `idx_projects_grandparent_aff` (`grandparent_affiliate_id`),
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
  CONSTRAINT `fk_projects_grandparent_aff`
    FOREIGN KEY (`grandparent_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_contractor`
    FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_admin`
    FOREIGN KEY (`assigned_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_plan`
    FOREIGN KEY (`adu_plan_id`) REFERENCES `adu_plans`(`id`) ON DELETE SET NULL,
  KEY `idx_projects_lender` (`lender_id`),
  CONSTRAINT `fk_projects_lender` FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON DELETE SET NULL
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
  `role` ENUM('direct','closer','parent','grandparent') NOT NULL DEFAULT 'direct'
    COMMENT 'direct = full rate; closer = referring share; parent = sponsor; grandparent = senior sponsor',
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

-- Affiliate onboarding: versioned agreement, signatures, W-9 (TIN only in private PDF)
-- 1) Versioned agreement text (super_admin edits → publishes a new version).
CREATE TABLE IF NOT EXISTS `affiliate_agreement_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version` INT UNSIGNED NOT NULL,
  `body_en` MEDIUMTEXT NOT NULL COMMENT 'Light markup: # / ## headings, - bullets, | tables, **bold**, {{placeholders}}',
  `body_es` MEDIUMTEXT NOT NULL,
  `notes` VARCHAR(500) DEFAULT NULL,
  `published_at` DATETIME DEFAULT NULL COMMENT 'NULL = draft; latest published version is signed',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aff_agreement_version` (`version`),
  CONSTRAINT `fk_aff_agreement_tpl_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) One row per signature (re-sign on a new version adds a row; latest wins).
CREATE TABLE IF NOT EXISTS `affiliate_agreements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `template_version` INT UNSIGNED NOT NULL,
  `lang` ENUM('en','es') NOT NULL DEFAULT 'en',
  `status` ENUM('signed','void') NOT NULL DEFAULT 'signed',
  `legal_name` VARCHAR(200) NOT NULL,
  `business_name` VARCHAR(200) DEFAULT NULL,
  `title` VARCHAR(120) DEFAULT NULL,
  `address` VARCHAR(400) NOT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `email` VARCHAR(255) NOT NULL,
  `subscription_price_cents` INT UNSIGNED NOT NULL,
  `sponsor_affiliate_id` INT UNSIGNED DEFAULT NULL COMMENT 'Snapshot of parent at signing',
  `sponsor_name` VARCHAR(200) DEFAULT NULL,
  `body_sha256` CHAR(64) NOT NULL COMMENT 'Hash of the exact rendered text signed',
  `signature_image` MEDIUMTEXT NOT NULL COMMENT 'PNG data URL',
  `signed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `pdf_blob_pathname` VARCHAR(500) DEFAULT NULL COMMENT 'Private Blob: signed PDF',
  `voided_at` DATETIME DEFAULT NULL,
  `voided_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `void_reason` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aff_agreements_affiliate` (`affiliate_id`, `status`),
  CONSTRAINT `fk_aff_agreements_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aff_agreements_sponsor`
    FOREIGN KEY (`sponsor_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_aff_agreements_voider`
    FOREIGN KEY (`voided_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) W-9 submissions. Full TIN lives only inside the private PDF.
CREATE TABLE IF NOT EXISTS `affiliate_w9s` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `status` ENUM('submitted','accepted','rejected') NOT NULL DEFAULT 'submitted',
  `legal_name` VARCHAR(200) NOT NULL,
  `business_name` VARCHAR(200) DEFAULT NULL,
  `tax_classification` ENUM('individual','c_corp','s_corp','partnership','trust_estate','llc','other') NOT NULL,
  `llc_tax_class` CHAR(1) DEFAULT NULL COMMENT 'C | S | P when tax_classification = llc',
  `other_classification` VARCHAR(120) DEFAULT NULL,
  `tin_type` ENUM('ssn','ein') NOT NULL,
  `tin_last4` CHAR(4) NOT NULL,
  `address` VARCHAR(255) NOT NULL,
  `city_state_zip` VARCHAR(255) NOT NULL,
  `pdf_blob_pathname` VARCHAR(500) NOT NULL,
  `signed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `review_note` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aff_w9_affiliate` (`affiliate_id`, `status`),
  CONSTRAINT `fk_aff_w9_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aff_w9_reviewer`
    FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Client updates feed (internal or shared with the referring affiliate)
CREATE TABLE IF NOT EXISTS `client_updates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('note','deal_status') NOT NULL DEFAULT 'note',
  `visibility` ENUM('internal','affiliate') NOT NULL DEFAULT 'internal',
  `body` TEXT DEFAULT NULL,
  `deal_status_id` INT UNSIGNED DEFAULT NULL,
  `deal_status_label_en` VARCHAR(80) DEFAULT NULL COMMENT 'Snapshot (status may be renamed later)',
  `deal_status_label_es` VARCHAR(80) DEFAULT NULL,
  `notified_affiliate_id` INT UNSIGNED DEFAULT NULL,
  `notified_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client_updates_client` (`client_id`, `id`),
  CONSTRAINT `fk_client_updates_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_updates_status`
    FOREIGN KEY (`deal_status_id`) REFERENCES `deal_statuses`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_client_updates_affiliate`
    FOREIGN KEY (`notified_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_client_updates_admin`
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
  ('commission_parent_shared_cents_per_sqft', '150', 'Sponsor share $/sqft cents ($1.50) when a Senior Sponsor also earns'),
  ('commission_grandparent_cents_per_sqft', '150', 'Senior Sponsor share $/sqft cents ($1.50)'),
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
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Preferred default sending line (staff + campaigns)',
  `line_mode` ENUM('shared','personal') NOT NULL DEFAULT 'personal' COMMENT 'shared = members + ring list; personal = one staff owner',
  `ring_timeout_sec` INT UNSIGNED NOT NULL DEFAULT 25 COMMENT 'Seconds to ring before voicemail',
  `voicemail_greeting_en` TEXT DEFAULT NULL COMMENT 'Line voicemail greeting (English); NULL = system default',
  `voicemail_greeting_es` TEXT DEFAULT NULL COMMENT 'Line voicemail greeting (Spanish); NULL = system default',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `removed_at` DATETIME DEFAULT NULL COMMENT 'Removed from the CRM (still in Twilio until released there)',
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
  `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'service_cities',
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
  KEY `idx_contacts_city` (`city_id`),
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

-- Phone line settings: members (see threads / browser rings) + screened ring numbers
CREATE TABLE IF NOT EXISTS `phone_line_members` (
  `line_id` INT UNSIGNED NOT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `ring_browser` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`line_id`, `admin_id`),
  KEY `idx_line_members_admin` (`admin_id`),
  CONSTRAINT `fk_line_members_line`
    FOREIGN KEY (`line_id`) REFERENCES `admin_phone_numbers`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_line_members_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `phone_line_ring_numbers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `line_id` INT UNSIGNED NOT NULL,
  `label` VARCHAR(80) NOT NULL,
  `e164` VARCHAR(20) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_line_ring_number` (`line_id`, `e164`),
  CONSTRAINT `fk_line_ring_line`
    FOREIGN KEY (`line_id`) REFERENCES `admin_phone_numbers`(`id`) ON DELETE CASCADE
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
  `channel` ENUM('sms','email') NOT NULL DEFAULT 'sms',
  `subject_en` VARCHAR(300) DEFAULT NULL,
  `subject_es` VARCHAR(300) DEFAULT NULL,
  `body_en` TEXT NOT NULL,
  `body_es` TEXT DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `category` ENUM('general','welcome','follow_up','reminder','status_update','documents','scheduling') NOT NULL DEFAULT 'general',
  `usage_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_used_at` DATETIME DEFAULT NULL,
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

-- Affiliate welcome flow: onboarding links, billing webhooks, FAQ, AI assistant log
CREATE TABLE IF NOT EXISTS `affiliate_onboarding_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aff_onboarding_token` (`token_hash`),
  KEY `idx_aff_onboarding_affiliate` (`affiliate_id`),
  CONSTRAINT `fk_aff_onboarding_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `billing_webhook_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` VARCHAR(80) NOT NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `processed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_webhook_event` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_faqs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `question_en` VARCHAR(300) NOT NULL,
  `answer_en` TEXT NOT NULL,
  `question_es` VARCHAR(300) DEFAULT NULL,
  `answer_es` TEXT DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_affiliate_faqs_active` (`is_active`, `sort_order`),
  CONSTRAINT `fk_affiliate_faqs_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_assistant_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `role` ENUM('user','assistant') NOT NULL,
  `content` TEXT NOT NULL,
  `handoff` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Assistant could not answer from the agreement/FAQ',
  `input_tokens` INT UNSIGNED DEFAULT NULL,
  `output_tokens` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aff_assistant_affiliate` (`affiliate_id`, `created_at`),
  CONSTRAINT `fk_aff_assistant_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lenders directory + scheduler (appointments, attendees, booking links)


CREATE TABLE IF NOT EXISTS `appointments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(200) NOT NULL,
  `kind` ENUM('property_inspection','site_visit','lender_meeting','consultation','call','city_meeting','other') NOT NULL DEFAULT 'consultation',
  `starts_at` DATETIME NOT NULL COMMENT 'UTC',
  `ends_at` DATETIME NOT NULL COMMENT 'UTC',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles',
  `location_type` ENUM('onsite','office','phone','video') NOT NULL DEFAULT 'onsite',
  `location` VARCHAR(500) DEFAULT NULL,
  `video_url` VARCHAR(500) DEFAULT NULL,
  `teams_meeting` TINYINT(1) NOT NULL DEFAULT 0,
  `show_as` ENUM('busy','free','tentative','oof','workingElsewhere','unknown') NOT NULL DEFAULT 'busy',
  `description` TEXT DEFAULT NULL COMMENT 'Shared with attendees',
  `notes` TEXT DEFAULT NULL COMMENT 'Internal (staff only)',
  `client_id` INT UNSIGNED DEFAULT NULL,
  `lead_id` BIGINT UNSIGNED DEFAULT NULL,
  `project_id` BIGINT UNSIGNED DEFAULT NULL,
  `owner_admin_id` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('scheduled','cancelled','completed','no_show') NOT NULL DEFAULT 'scheduled',
  `source` ENUM('staff','booking','outlook','city_partner') NOT NULL DEFAULT 'staff',
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
  `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'City meeting: service_cities',
  `city_partner_id` INT UNSIGNED DEFAULT NULL COMMENT 'City meeting booked by this City Partner',
  PRIMARY KEY (`id`),
  KEY `idx_appointments_city_partner` (`city_partner_id`, `starts_at`),
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

-- Affiliate link-name history (old /r/<slug> keeps working 30 days)
CREATE TABLE IF NOT EXISTS `affiliate_slug_history` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `slug` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aff_slug_history_slug` (`slug`, `expires_at`),
  KEY `idx_aff_slug_history_affiliate` (`affiliate_id`),
  CONSTRAINT `fk_aff_slug_history_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin billing: action log + staff-sent card links
CREATE TABLE IF NOT EXISTS `billing_admin_actions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_role` ENUM('affiliate','contractor') NOT NULL,
  `member_id` INT UNSIGNED NOT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `action` VARCHAR(40) NOT NULL COMMENT 'cancel_now | cancel_period_end | resume | extend | refund | price | card_link',
  `reason` TEXT DEFAULT NULL,
  `detail_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_billing_actions_member` (`member_role`, `member_id`),
  CONSTRAINT `fk_billing_actions_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `billing_card_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_role` ENUM('affiliate','contractor') NOT NULL,
  `member_id` INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `price_cents` INT UNSIGNED DEFAULT NULL COMMENT 'NULL = keep the member price',
  `free_days` INT UNSIGNED DEFAULT NULL COMMENT 'NULL = standard rule (trial once)',
  `note` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME DEFAULT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_card_link_token` (`token_hash`),
  KEY `idx_billing_card_link_member` (`member_role`, `member_id`),
  CONSTRAINT `fk_billing_card_link_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Mail + calendar sync (Microsoft 365 / Graph)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mailboxes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(200) DEFAULT NULL,
  `kind` ENUM('personal','shared') NOT NULL DEFAULT 'personal',
  `auth_mode` ENUM('app','delegated') NOT NULL DEFAULT 'app',
  `oauth_user_id` VARCHAR(100) DEFAULT NULL,
  `oauth_access_token` TEXT DEFAULT NULL,
  `oauth_refresh_token` TEXT DEFAULT NULL,
  `oauth_expires_at` DATETIME DEFAULT NULL,
  `owner_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Personal mailbox owner (calendar owner for appointments)',
  `status` ENUM('active','paused','error') NOT NULL DEFAULT 'active',
  `mail_sync_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `calendar_sync_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `mail_delta_inbox` TEXT DEFAULT NULL COMMENT 'Graph delta/next link for Inbox',
  `mail_delta_sent` TEXT DEFAULT NULL COMMENT 'Graph delta/next link for Sent Items',
  `signature_html` TEXT DEFAULT NULL,
  `last_mail_sync_at` DATETIME DEFAULT NULL,
  `mail_folders_synced_at` DATETIME DEFAULT NULL,
  `last_calendar_sync_at` DATETIME DEFAULT NULL,
  `last_error` VARCHAR(1000) DEFAULT NULL,
  `error_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mailboxes_email` (`email`),
  KEY `idx_mailboxes_owner` (`owner_admin_id`),
  KEY `idx_mailboxes_status` (`status`),
  CONSTRAINT `fk_mailboxes_owner` FOREIGN KEY (`owner_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mailboxes_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mailbox_access` (
  `mailbox_id` INT UNSIGNED NOT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `can_send` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`mailbox_id`, `admin_id`),
  KEY `idx_mailbox_access_admin` (`admin_id`),
  CONSTRAINT `fk_mailbox_access_mailbox` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mailbox_access_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mail_threads` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mailbox_id` INT UNSIGNED NOT NULL,
  `graph_conversation_id` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(500) DEFAULT NULL,
  `snippet` VARCHAR(500) DEFAULT NULL,
  `participants_json` JSON DEFAULT NULL COMMENT '[{email,name}] excluding the mailbox itself',
  `last_message_at` DATETIME DEFAULT NULL,
  `last_direction` ENUM('inbound','outbound') DEFAULT NULL,
  `message_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `unread_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `has_attachments` TINYINT(1) NOT NULL DEFAULT 0,
  `has_inbound` TINYINT(1) NOT NULL DEFAULT 0,
  `has_outbound` TINYINT(1) NOT NULL DEFAULT 0,
  `archived` TINYINT(1) NOT NULL DEFAULT 0,
  `filed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Inbound mail filed in a custom folder, none left in Inbox',
  `match_kind` ENUM('client','lead','affiliate','contractor','contact') DEFAULT NULL,
  `match_id` BIGINT UNSIGNED DEFAULT NULL,
  `match_name` VARCHAR(200) DEFAULT NULL,
  `match_email` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mail_threads_conv` (`mailbox_id`, `graph_conversation_id`),
  KEY `idx_mail_threads_last` (`mailbox_id`, `last_message_at`),
  KEY `idx_mail_threads_match` (`match_kind`, `match_id`),
  KEY `idx_mail_threads_match_email` (`match_email`),
  CONSTRAINT `fk_mail_threads_mailbox` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mail_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mailbox_id` INT UNSIGNED NOT NULL,
  `thread_id` INT UNSIGNED NOT NULL,
  `graph_id` VARCHAR(255) NOT NULL,
  `internet_message_id` VARCHAR(500) DEFAULT NULL,
  `folder` ENUM('inbox','sent','archive','custom') NOT NULL,
  `mail_folder_id` INT UNSIGNED DEFAULT NULL COMMENT 'Set when folder = custom',
  `direction` ENUM('inbound','outbound') NOT NULL,
  `from_email` VARCHAR(255) DEFAULT NULL,
  `from_name` VARCHAR(255) DEFAULT NULL,
  `to_json` JSON DEFAULT NULL,
  `cc_json` JSON DEFAULT NULL,
  `subject` VARCHAR(500) DEFAULT NULL,
  `body_preview` VARCHAR(500) DEFAULT NULL,
  `body_html` MEDIUMTEXT DEFAULT NULL,
  `sent_at` DATETIME NOT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 1,
  `has_attachments` TINYINT(1) NOT NULL DEFAULT 0,
  `sent_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `alerted_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mail_messages_graph` (`mailbox_id`, `graph_id`),
  KEY `idx_mail_messages_thread` (`thread_id`, `sent_at`),
  KEY `idx_mail_messages_from` (`from_email`),
  KEY `idx_mail_messages_folder` (`mail_folder_id`, `thread_id`),
  CONSTRAINT `fk_mail_messages_mailbox` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mail_messages_thread` FOREIGN KEY (`thread_id`) REFERENCES `mail_threads`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mail_messages_admin` FOREIGN KEY (`sent_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mail_folders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mailbox_id` INT UNSIGNED NOT NULL,
  `graph_id` VARCHAR(255) NOT NULL,
  `parent_graph_id` VARCHAR(255) DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `delta_link` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mail_folders_graph` (`mailbox_id`, `graph_id`),
  CONSTRAINT `fk_mail_folders_mailbox` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mail_rules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mailbox_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `from_contains` VARCHAR(255) DEFAULT NULL,
  `subject_contains` VARCHAR(255) DEFAULT NULL,
  `person_kind` ENUM('any_crm','client','lead','affiliate','contractor','contact') DEFAULT NULL,
  `folder_id` INT UNSIGNED NOT NULL,
  `mark_read` TINYINT(1) NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mail_rules_box` (`mailbox_id`, `active`),
  CONSTRAINT `fk_mail_rules_mailbox` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mail_rules_folder` FOREIGN KEY (`folder_id`) REFERENCES `mail_folders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Add-your-card reminders (same migration)
ALTER TABLE `affiliates` ADD COLUMN `card_reminder_count` TINYINT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN `card_reminder_last_at` DATETIME DEFAULT NULL;

-- One appointment can live on several Outlook calendars (owner + staff attendees).
CREATE TABLE IF NOT EXISTS `appointment_calendar_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appointment_id` INT UNSIGNED NOT NULL,
  `mailbox_id` INT UNSIGNED NOT NULL,
  `graph_event_id` VARCHAR(255) NOT NULL,
  `ical_uid` VARCHAR(500) DEFAULT NULL,
  `change_key` VARCHAR(255) DEFAULT NULL,
  `origin` ENUM('crm','outlook') NOT NULL DEFAULT 'crm',
  `last_synced_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_appt_cal_links_event` (`mailbox_id`, `graph_event_id`),
  UNIQUE KEY `uq_appt_cal_links_appt_mailbox` (`appointment_id`, `mailbox_id`),
  KEY `idx_appt_cal_links_ical` (`ical_uid`(191)),
  CONSTRAINT `fk_appt_cal_links_appt` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_appt_cal_links_mailbox` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mail_drafts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mailbox_id` INT UNSIGNED NOT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `mode` ENUM('new','reply','replyAll','forward') NOT NULL DEFAULT 'new',
  `source_message_id` INT UNSIGNED DEFAULT NULL COMMENT 'Message replied to / forwarded',
  `to_json` JSON DEFAULT NULL,
  `cc_json` JSON DEFAULT NULL,
  `subject` VARCHAR(400) DEFAULT NULL,
  `html` MEDIUMTEXT DEFAULT NULL,
  `attachments_json` MEDIUMTEXT DEFAULT NULL COMMENT '[{name, content_type, base64}] (3 MB total)',
  `graph_draft_id` VARCHAR(255) DEFAULT NULL COMMENT 'Mirror in Outlook Drafts',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mail_drafts_admin` (`admin_id`, `updated_at`),
  KEY `idx_mail_drafts_mailbox` (`mailbox_id`),
  CONSTRAINT `fk_mail_drafts_mailbox` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mail_drafts_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mail_drafts_source` FOREIGN KEY (`source_message_id`) REFERENCES `mail_messages`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff notification routing
CREATE TABLE IF NOT EXISTS `notify_routing` (
  `area` VARCHAR(40) NOT NULL,
  `admin_ids_json` JSON NOT NULL,
  `include_owner` TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Also the record''s assigned staff member',
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`area`),
  CONSTRAINT `fk_notify_routing_admin` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Partner types / client lender FKs (20261024_110000)
ALTER TABLE `affiliates` ADD CONSTRAINT `fk_affiliates_lender` FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON DELETE SET NULL;
ALTER TABLE `clients` ADD CONSTRAINT `fk_clients_lender` FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON DELETE SET NULL;

-- Automatic messages log
CREATE TABLE IF NOT EXISTS `automatic_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel` ENUM('email','sms') NOT NULL,
  `to_address` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(500) DEFAULT NULL,
  `body_preview` TEXT DEFAULT NULL,
  `person_kind` ENUM('client','lead','affiliate','contractor','contact') NOT NULL,
  `person_id` BIGINT UNSIGNED NOT NULL,
  `conversation_message_id` INT UNSIGNED DEFAULT NULL,
  `dry_run` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_auto_msgs_person` (`person_kind`, `person_id`, `created_at`),
  CONSTRAINT `fk_auto_msgs_conv_msg` FOREIGN KEY (`conversation_message_id`) REFERENCES `conversation_messages`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reminder flows
CREATE TABLE IF NOT EXISTS `reminder_flows` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `trigger_event` VARCHAR(60) NOT NULL COMMENT 'affiliate_signup, contractor_signup, homeowner_lead, event_rsvp, lead_answer_*, milestone_*, contract_sent, appointment_*, card_expiring, payment_failed',
  `goal_key` VARCHAR(60) DEFAULT NULL COMMENT 'Auto-stop when met (affiliate_onboarded, contractor_documents, homeowner_next_step, contract_signed, …)',
  `stop_on_reply` TINYINT(1) NOT NULL DEFAULT 1,
  `quiet_start_hour` TINYINT UNSIGNED NOT NULL DEFAULT 9 COMMENT 'Texts only between these hours (America/Los_Angeles)',
  `quiet_end_hour` TINYINT UNSIGNED NOT NULL DEFAULT 19,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `system_key` VARCHAR(60) DEFAULT NULL COMMENT 'Seeded flows (affiliate_onboarding, contractor_onboarding, homeowner_followup)',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reminder_flows_system` (`system_key`),
  KEY `idx_reminder_flows_trigger` (`trigger_event`, `is_active`),
  CONSTRAINT `fk_reminder_flows_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_reminder_flows_updater` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_steps` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id` INT UNSIGNED NOT NULL,
  `step_key` VARCHAR(60) NOT NULL,
  `step_type` ENUM('trigger','wait','send_email','send_sms','notify_staff','condition','wait_for_reply','close','end') NOT NULL,
  `label` VARCHAR(160) NOT NULL,
  `config_json` JSON DEFAULT NULL COMMENT 'wait: {amount, unit}; send_*: {subject_en, subject_es, body_en, body_es}; condition: {check}; wait_for_reply: {amount, unit}',
  `position_x` FLOAT NOT NULL DEFAULT 0,
  `position_y` FLOAT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_flow_step_key` (`flow_id`, `step_key`),
  CONSTRAINT `fk_flow_steps_flow` FOREIGN KEY (`flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_edges` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id` INT UNSIGNED NOT NULL,
  `source_key` VARCHAR(60) NOT NULL,
  `target_key` VARCHAR(60) NOT NULL,
  `edge_type` ENUM('next','yes','no','replied','no_reply') NOT NULL DEFAULT 'next',
  PRIMARY KEY (`id`),
  KEY `idx_flow_edges_source` (`flow_id`, `source_key`),
  CONSTRAINT `fk_flow_edges_flow` FOREIGN KEY (`flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_runs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id` INT UNSIGNED NOT NULL,
  `subject_kind` ENUM('lead','client','affiliate','contractor','project','appointment') NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('active','paused','goal_met','completed','stopped','closed','failed') NOT NULL DEFAULT 'active',
  `active_key` VARCHAR(80) DEFAULT NULL COMMENT 'flow:kind:id while active/paused (one live run per person per flow)',
  `current_step_key` VARCHAR(60) DEFAULT NULL,
  `next_run_at` DATETIME DEFAULT NULL,
  `waiting_since` DATETIME DEFAULT NULL COMMENT 'wait_for_reply started',
  `end_reason` VARCHAR(160) DEFAULT NULL,
  `added_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `entered_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `context_json` JSON DEFAULT NULL,
  `last_reply_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_flow_runs_active` (`active_key`),
  KEY `idx_flow_runs_due` (`status`, `next_run_at`),
  KEY `idx_flow_runs_subject` (`subject_kind`, `subject_id`),
  KEY `idx_flow_runs_flow` (`flow_id`, `status`),
  CONSTRAINT `fk_flow_runs_flow` FOREIGN KEY (`flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_flow_runs_admin` FOREIGN KEY (`added_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` INT UNSIGNED NOT NULL,
  `flow_id` INT UNSIGNED NOT NULL,
  `step_key` VARCHAR(60) DEFAULT NULL,
  `event` ENUM('entered','sent','skipped','failed','clicked','replied','goal_met','opted_out','paused','resumed','skipped_step','removed','closed','completed') NOT NULL,
  `channel` ENUM('email','sms','staff','none') NOT NULL DEFAULT 'none',
  `detail_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_flow_events_run` (`run_id`, `created_at`),
  KEY `idx_flow_events_stats` (`flow_id`, `step_key`, `event`),
  CONSTRAINT `fk_flow_events_run` FOREIGN KEY (`run_id`) REFERENCES `reminder_flow_runs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracked links in flow messages (click stats; also counts as engagement).
CREATE TABLE IF NOT EXISTS `reminder_flow_links` (
  `token` CHAR(24) NOT NULL,
  `run_id` INT UNSIGNED NOT NULL,
  `step_key` VARCHAR(60) NOT NULL,
  `url` VARCHAR(1000) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_flow_links_run` (`run_id`),
  CONSTRAINT `fk_flow_links_run` FOREIGN KEY (`run_id`) REFERENCES `reminder_flow_runs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STOP / ALTO replies: no automatic texts to this number again (until they text START).
CREATE TABLE IF NOT EXISTS `sms_opt_outs` (
  `phone_last10` CHAR(10) NOT NULL,
  `opted_out_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `keyword` VARCHAR(20) DEFAULT NULL,
  PRIMARY KEY (`phone_last10`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ADU construction agreements (20261026_100000) ──
CREATE TABLE IF NOT EXISTS `construction_agreement_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version` INT UNSIGNED NOT NULL,
  `body_en` MEDIUMTEXT NOT NULL COMMENT 'Light markup: # / ## headings, - bullets, | tables, **bold**, {{fields}}',
  `notes` VARCHAR(500) DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL COMMENT 'NULL = draft (watermarked, cannot be sent for signature)',
  `approved_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ca_template_version` (`version`),
  CONSTRAINT `fk_ca_tpl_approver` FOREIGN KEY (`approved_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ca_tpl_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `construction_agreements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `template_version` INT UNSIGNED NOT NULL,
  `status` ENUM('draft','sent','signed','void') NOT NULL DEFAULT 'draft',
  `fields_json` JSON DEFAULT NULL COMMENT 'Merge values (prefilled from the CRM, edited by staff)',
  `body_rendered` MEDIUMTEXT DEFAULT NULL COMMENT 'Exact text frozen when sent for signature',
  `body_sha256` CHAR(64) DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `signed_at` DATETIME DEFAULT NULL COMMENT 'All three parties signed',
  `pdf_blob_pathname` VARCHAR(500) DEFAULT NULL COMMENT 'Private Blob: signed PDF',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `voided_at` DATETIME DEFAULT NULL,
  `voided_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `void_reason` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ca_project` (`project_id`, `status`),
  CONSTRAINT `fk_ca_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ca_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ca_voider` FOREIGN KEY (`voided_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `construction_agreement_signers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `agreement_id` INT UNSIGNED NOT NULL,
  `party` ENUM('client','contractor','groundwork') NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `title` VARCHAR(120) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `license_number` VARCHAR(60) DEFAULT NULL,
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `token_hash` CHAR(64) DEFAULT NULL COMMENT 'sha256 of the signing link token (client / contractor)',
  `status` ENUM('pending','signed') NOT NULL DEFAULT 'pending',
  `signed_name` VARCHAR(200) DEFAULT NULL,
  `signature_image` MEDIUMTEXT DEFAULT NULL COMMENT 'PNG data URL',
  `signed_at` DATETIME DEFAULT NULL,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `signed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `viewed_at` DATETIME DEFAULT NULL,
  `last_sent_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ca_signer_party` (`agreement_id`, `party`),
  UNIQUE KEY `uq_ca_signer_token` (`token_hash`),
  CONSTRAINT `fk_ca_signer_agreement` FOREIGN KEY (`agreement_id`) REFERENCES `construction_agreements`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ca_signer_admin` FOREIGN KEY (`signed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Legal pages: Terms, Privacy, Refunds (20261028_100000, 20261028_110000) ──
CREATE TABLE IF NOT EXISTS `legal_documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` ENUM('terms','privacy','refunds') NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `status` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  `title_en` VARCHAR(200) NOT NULL,
  `title_es` VARCHAR(200) NOT NULL,
  `body_en` MEDIUMTEXT NOT NULL COMMENT 'Markdown: # / ## / ### headings, - bullets, | tables, **bold**, [links](url), {{live fields}}',
  `body_es` MEDIUMTEXT NOT NULL,
  `effective_date` DATE DEFAULT NULL COMMENT 'Set when published',
  `requires_reacceptance` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Material change: members accept again on next portal visit',
  `notify_members` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Email active/pending affiliates and contractors about this version',
  `notes` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `published_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `published_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_slug_version` (`slug`, `version`),
  KEY `idx_legal_slug_status` (`slug`, `status`),
  CONSTRAINT `fk_legal_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_legal_publisher` FOREIGN KEY (`published_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `legal_acceptances` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `person_kind` ENUM('affiliate','contractor','client') NOT NULL,
  `person_id` INT UNSIGNED NOT NULL,
  `slug` ENUM('terms','privacy','refunds') NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `context` ENUM('signup','reaccept','staff') NOT NULL DEFAULT 'signup',
  `accepted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_accept` (`person_kind`, `person_id`, `slug`, `version`),
  KEY `idx_legal_accept_person` (`person_kind`, `person_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `legal_notices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` ENUM('terms','privacy','refunds') NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `person_kind` ENUM('affiliate','contractor') NOT NULL,
  `person_id` INT UNSIGNED NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_notice` (`slug`, `version`, `person_kind`, `person_id`),
  KEY `idx_legal_notice_person` (`person_kind`, `person_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dynamic QR codes (migration 20261029_100000_qr_links.sql)
CREATE TABLE IF NOT EXISTS `qr_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(64) NOT NULL COMMENT 'Permanent: printed into the QR as /go/{slug}',
  `label` VARCHAR(160) NOT NULL,
  `destination_url` VARCHAR(1000) NOT NULL COMMENT 'Resolved when saved; live scans use dest_*',
  `dest_type` ENUM('page','event','next_event','affiliate','external') NOT NULL DEFAULT 'page',
  `dest_key` VARCHAR(40) DEFAULT NULL COMMENT 'page key; NULL page = older code using destination_url',
  `dest_id` INT UNSIGNED DEFAULT NULL COMMENT 'event, affiliate or external link id',
  `fallback_type` ENUM('page','event','next_event','affiliate','external') DEFAULT NULL COMMENT 'NULL = home page',
  `fallback_key` VARCHAR(40) DEFAULT NULL,
  `fallback_id` INT UNSIGNED DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = scans go to the fallback',
  `archived_at` DATETIME DEFAULT NULL,
  `scan_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_scanned_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_qr_links_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- QR codes: approved external links, daily scans, change history (20261030_110000_qr_destinations.sql)
CREATE TABLE IF NOT EXISTS `qr_external_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `label` VARCHAR(160) NOT NULL,
  `url` VARCHAR(1000) NOT NULL COMMENT 'https only, checked when saved',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qr_link_daily` (
  `qr_link_id` INT UNSIGNED NOT NULL,
  `day` DATE NOT NULL COMMENT 'Pacific',
  `dest_ref` VARCHAR(64) NOT NULL COMMENT 'page:home, event:12, next_event, ...',
  `dest_label` VARCHAR(200) NOT NULL,
  `scans` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`qr_link_id`, `day`, `dest_ref`),
  CONSTRAINT `fk_qr_daily_link` FOREIGN KEY (`qr_link_id`) REFERENCES `qr_links` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qr_link_changes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `qr_link_id` INT UNSIGNED NOT NULL,
  `action` ENUM('created','destination','fallback','label','on','off','archived','restored') NOT NULL,
  `before_text` VARCHAR(300) DEFAULT NULL,
  `after_text` VARCHAR(300) DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_qr_changes_link` (`qr_link_id`, `id`),
  CONSTRAINT `fk_qr_changes_link` FOREIGN KEY (`qr_link_id`) REFERENCES `qr_links` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- First QR scan credit (same migration)
ALTER TABLE `leads` ADD COLUMN `qr_link_id` INT UNSIGNED DEFAULT NULL, ADD KEY `idx_leads_qr_link` (`qr_link_id`);
ALTER TABLE `clients` ADD COLUMN `qr_link_id` INT UNSIGNED DEFAULT NULL, ADD KEY `idx_clients_qr_link` (`qr_link_id`);
ALTER TABLE `affiliates` ADD COLUMN `qr_link_id` INT UNSIGNED DEFAULT NULL, ADD KEY `idx_affiliates_qr_link` (`qr_link_id`);
ALTER TABLE `contractors` ADD COLUMN `qr_link_id` INT UNSIGNED DEFAULT NULL, ADD KEY `idx_contractors_qr_link` (`qr_link_id`);

-- Cities (20261030_130000_service_cities.sql). Visibility only, never commissions.
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

ALTER TABLE `leads` ADD COLUMN `city_id` INT UNSIGNED DEFAULT NULL, ADD KEY `idx_leads_city` (`city_id`);
ALTER TABLE `clients` ADD COLUMN `city_id` INT UNSIGNED DEFAULT NULL, ADD KEY `idx_clients_city` (`city_id`);
ALTER TABLE `projects` ADD COLUMN `city_id` INT UNSIGNED DEFAULT NULL, ADD KEY `idx_projects_city` (`city_id`);

-- City Partners (20261102_100000_city_partners.sql): invite-only portal /city. Template v1 body is in the migration.
CREATE TABLE IF NOT EXISTS `city_partners` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL DEFAULT '',
  `phone` VARCHAR(40) DEFAULT NULL,
  `company` VARCHAR(200) DEFAULT NULL COMMENT 'LLC legal name used in the agreement',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active' COMMENT 'Only staff create rows (invite-only)',
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `fee_cents_per_sqft` INT UNSIGNED NOT NULL DEFAULT 200 COMMENT 'Opened City fee, frozen into each agreement',
  `notes` TEXT DEFAULT NULL,
  `invited_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `invited_at` DATETIME DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_city_partners_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS `city_partner_otp_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('login','email_verify','signup') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cp_otp_partner` (`city_partner_id`),
  CONSTRAINT `fk_cp_otp_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `viewer_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Set = read-only View as partner session opened by this super admin',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cp_sessions_token` (`token_hash`),
  KEY `idx_cp_sessions_partner` (`city_partner_id`),
  CONSTRAINT `fk_cp_sessions_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_cities` (
  `city_partner_id` INT UNSIGNED NOT NULL,
  `city_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`city_partner_id`, `city_id`),
  KEY `idx_cp_cities_city` (`city_id`),
  CONSTRAINT `fk_cp_cities_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cp_cities_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_agreement_templates` (
  `version` INT UNSIGNED NOT NULL,
  `body` MEDIUMTEXT NOT NULL COMMENT 'Placeholders: {{partner_legal_name}}, {{fee_per_sqft}}',
  `approved_at` DATETIME DEFAULT NULL COMMENT 'NULL = draft, never sent',
  `notes` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `city_partner_agreements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `template_version` INT UNSIGNED NOT NULL,
  `fee_cents_per_sqft` INT UNSIGNED NOT NULL,
  `body_rendered` MEDIUMTEXT NOT NULL,
  `body_sha256` CHAR(64) NOT NULL,
  `signer_name` VARCHAR(200) NOT NULL,
  `signer_title` VARCHAR(120) DEFAULT NULL,
  `signed_at` DATETIME NOT NULL,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `countersigned_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `countersigner_name` VARCHAR(200) DEFAULT NULL,
  `countersigned_at` DATETIME DEFAULT NULL,
  `voided_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cp_agreements_partner` (`city_partner_id`, `id`),
  CONSTRAINT `fk_cp_agreements_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_w9s` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `status` ENUM('submitted','accepted','rejected') NOT NULL DEFAULT 'submitted',
  `legal_name` VARCHAR(200) NOT NULL,
  `business_name` VARCHAR(200) DEFAULT NULL,
  `tax_classification` VARCHAR(20) NOT NULL,
  `tin_type` ENUM('ssn','ein') NOT NULL,
  `tin_last4` CHAR(4) NOT NULL,
  `pdf_blob_pathname` VARCHAR(500) NOT NULL,
  `signed_at` DATETIME NOT NULL,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `review_note` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cp_w9_partner` (`city_partner_id`, `id`),
  CONSTRAINT `fk_cp_w9_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS `city_contacts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('elected','city_staff','planning','building','consultant') NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `title` VARCHAR(160) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `notes` VARCHAR(500) DEFAULT NULL,
  `verified_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_city_contacts_city` (`city_id`),
  CONSTRAINT `fk_city_contacts_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_activities` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_id` INT UNSIGNED NOT NULL,
  `city_partner_id` INT UNSIGNED DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `occurred_on` DATE NOT NULL,
  `activity_type` ENUM('call','email','meeting','presentation','follow_up','plan_submission','other') NOT NULL,
  `contact_name` VARCHAR(160) DEFAULT NULL,
  `summary` VARCHAR(1000) NOT NULL,
  `next_step` VARCHAR(300) DEFAULT NULL,
  `follow_up_on` DATE DEFAULT NULL,
  `link_url` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_city_activities_city` (`city_id`, `occurred_on`),
  CONSTRAINT `fk_city_activities_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_city_activities_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS `city_partner_fees` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `city_id` INT UNSIGNED NOT NULL,
  `sq_ft` INT UNSIGNED NOT NULL,
  `rate_cents_per_sqft` INT UNSIGNED NOT NULL,
  `amount_cents` INT UNSIGNED NOT NULL,
  `status` ENUM('pending','approved','paid','void','refund_due','refunded') NOT NULL DEFAULT 'pending',
  `due_on` DATE NOT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cp_fee_project` (`project_id`, `city_partner_id`),
  KEY `idx_cp_fee_partner` (`city_partner_id`, `status`),
  CONSTRAINT `fk_cp_fee_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cp_fee_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `service_cities` ADD COLUMN `county` VARCHAR(100) DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `priority` ENUM('high','medium','low','unknown') NOT NULL DEFAULT 'unknown';
ALTER TABLE `service_cities` ADD COLUMN `pipeline_stage` ENUM('target','official_contacted','meeting_scheduled','official_support','referred_to_staff','staff_meeting','plans_submitted','in_review','comments_received','resubmitted','preapproved','on_hold') DEFAULT NULL COMMENT 'NULL = not in the pipeline';
ALTER TABLE `service_cities` ADD COLUMN `interest` ENUM('high','medium','low','unknown') NOT NULL DEFAULT 'unknown';
ALTER TABLE `service_cities` ADD COLUMN `next_action` VARCHAR(300) DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `next_action_on` DATE DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `plan_set` VARCHAR(200) DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `submitted_on` DATE DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `review_round` TINYINT UNSIGNED DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `comments_on` DATE DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `resubmitted_on` DATE DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `opened_on` DATE DEFAULT NULL COMMENT 'Opened City: plans pre-approved; City Partner fees start';
ALTER TABLE `service_cities` ADD COLUMN `pipeline_notes` TEXT DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `council_summary` TEXT DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `adu_program_status` ENUM('none','in_development','active','paused','unknown') NOT NULL DEFAULT 'unknown';
ALTER TABLE `service_cities` ADD COLUMN `adu_program_notes` TEXT DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `intel_sources` TEXT DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `intel_verified_at` DATETIME DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `intel_verified_by_admin_id` INT UNSIGNED DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN `archived_at` DATETIME DEFAULT NULL COMMENT 'Hidden everywhere, history kept (20261102_120000_city_archive.sql)';
ALTER TABLE `projects` ADD COLUMN `funds_received_on` DATE DEFAULT NULL COMMENT 'Starts City Partner fees (due +5 days)';

-- Scorecards (Admin -> Scorecards, SCORECARD_ENABLED)
-- Logged work: calls, contact made, next step + note, weekly status review, homeowner update,
-- events an affiliate ran. Staff log it; it is the documentation behind every score.
CREATE TABLE IF NOT EXISTS `scorecard_activities` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` ENUM('affiliate','contractor') NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('call_attempt','contacted','next_step','status_review','homeowner_update','event_held') NOT NULL,
  `outcome` ENUM('answered','no_answer','voicemail') DEFAULT NULL COMMENT 'call_attempt only',
  `lead_id` BIGINT UNSIGNED DEFAULT NULL,
  `project_id` BIGINT UNSIGNED DEFAULT NULL,
  `note` TEXT DEFAULT NULL,
  `occurred_at` DATETIME NOT NULL COMMENT 'UTC',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sc_act_subject` (`subject_type`, `subject_id`, `occurred_at`),
  KEY `idx_sc_act_lead` (`lead_id`),
  KEY `idx_sc_act_project` (`project_id`),
  CONSTRAINT `fk_sc_act_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sc_act_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sc_act_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plans the contractor owes on a project (due date vs delivered).
CREATE TABLE IF NOT EXISTS `project_plan_deliverables` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `due_on` DATE NOT NULL,
  `delivered_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_plan_deliv_project` (`project_id`),
  KEY `idx_plan_deliv_due` (`due_on`),
  CONSTRAINT `fk_plan_deliv_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plan_deliv_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- City plan-check corrections: received -> resolved (goal: 5 working days).
CREATE TABLE IF NOT EXISTS `project_city_corrections` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `received_on` DATE NOT NULL,
  `resolved_on` DATE DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_city_corr_project` (`project_id`),
  CONSTRAINT `fk_city_corr_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_city_corr_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Target date per project stage; reached = first project_milestone_events row into that stage.
CREATE TABLE IF NOT EXISTS `project_milestone_targets` (
  `project_id` BIGINT UNSIGNED NOT NULL,
  `milestone` ENUM('financing','contracted','in_build','closed') NOT NULL,
  `due_on` DATE NOT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`, `milestone`),
  KEY `idx_ms_target_due` (`due_on`),
  CONSTRAINT `fk_ms_target_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Days off (inclusive, Pacific dates): skipped by every clock and never counted.
CREATE TABLE IF NOT EXISTS `scorecard_time_off` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` ENUM('affiliate','contractor') NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `starts_on` DATE NOT NULL,
  `ends_on` DATE NOT NULL,
  `label` VARCHAR(160) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sc_off_subject` (`subject_type`, `subject_id`, `starts_on`),
  CONSTRAINT `fk_sc_off_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per person, scorecard and week (Mon-Sun Pacific). Frozen (final = 1) 3 days after
-- the week ends; until then it is recalculated live.
CREATE TABLE IF NOT EXISTS `scorecard_weeks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` ENUM('affiliate','contractor') NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `scorecard` ENUM('lead_rep','coordinator','affiliate') NOT NULL,
  `week_start` DATE NOT NULL,
  `score` DECIMAL(5,1) DEFAULT NULL COMMENT 'NULL = nothing to grade this week',
  `grade` CHAR(1) DEFAULT NULL,
  `color` ENUM('green','yellow','orange','red','none') NOT NULL DEFAULT 'none',
  `termination_review` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Red two weeks in a row',
  `metrics_json` JSON NOT NULL,
  `final` TINYINT(1) NOT NULL DEFAULT 0,
  `computed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sc_week` (`subject_type`, `subject_id`, `scorecard`, `week_start`),
  KEY `idx_sc_week_start` (`week_start`, `final`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Follow-up record per frozen week: automatic coaching note (yellow), meeting with Cesar/Daniel
-- + written plan (orange), written warning (red), termination review (red twice). Staff add notes
-- and close each one; the whole log is the documentation.
CREATE TABLE IF NOT EXISTS `scorecard_actions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` ENUM('affiliate','contractor') NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `scorecard` ENUM('lead_rep','coordinator','affiliate') NOT NULL,
  `week_start` DATE NOT NULL,
  `kind` ENUM('coaching_note','meeting','written_warning','termination_review','note') NOT NULL,
  `auto` TINYINT(1) NOT NULL DEFAULT 0,
  `auto_key` VARCHAR(120) DEFAULT NULL COMMENT 'Set on automatic rows so a week never escalates twice',
  `body` TEXT DEFAULT NULL,
  `resolution` TEXT DEFAULT NULL COMMENT 'Written plan / meeting notes / signed warning',
  `status` ENUM('open','done') NOT NULL DEFAULT 'open',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `completed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sc_action_subject` (`subject_type`, `subject_id`, `created_at`),
  KEY `idx_sc_action_open` (`status`, `created_at`),
  UNIQUE KEY `uq_sc_action_auto` (`auto_key`),
  CONSTRAINT `fk_sc_action_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sc_action_done_admin` FOREIGN KEY (`completed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
