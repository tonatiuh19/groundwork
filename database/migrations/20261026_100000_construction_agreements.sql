-- ADU construction agreement: versioned template (DRAFT until a super admin marks a version
-- attorney-approved), one agreement per project filled from the CRM, e-signed by client,
-- contractor and Groundwork, signed PDF stored privately.

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
