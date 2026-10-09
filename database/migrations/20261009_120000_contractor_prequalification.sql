-- ADU Contractor Prequalification Application (online wizard + private document vault).
-- One application per contractor; reopened (not duplicated) for re-qualification.

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

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('cpq_template_master_contractor_agreement', NULL, 'Prequalification: blank Master Contractor Agreement PDF URL (contractor signs + uploads)'),
  ('cpq_template_background_check_authorization', NULL, 'Prequalification: blank Background Check Authorization PDF URL')
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`);
