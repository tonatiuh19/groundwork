-- Campaigns hub: marketing broadcasts (Resend Segments + Twilio SMS) with consent + reply tags.
-- TiDB / MySQL 8 compatible.

ALTER TABLE `leads`
  ADD COLUMN `sms_marketing_consent` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'TCPA: required for campaign SMS' AFTER `soft_pull_consent`,
  ADD COLUMN `audience_tag` VARCHAR(40) DEFAULT NULL
    COMMENT 'homeowner|information|affiliate_lead|contractor_lead' AFTER `status`;

ALTER TABLE `affiliates`
  ADD COLUMN `sms_marketing_consent` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'TCPA: required for campaign SMS' AFTER `preferred_language`;

ALTER TABLE `contractors`
  ADD COLUMN `sms_marketing_consent` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'TCPA: required for campaign SMS' AFTER `preferred_language`;

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

-- Track which campaign opener a recipient last received (for reply follow-ups).
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
