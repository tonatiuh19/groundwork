-- Groundwork Conversations Contact Hub (Optimum-parity SMS/CRM)
-- Brand Twilio lines in admin_phone_numbers; Conversations unlocks only when assigned.
-- TiDB Cloud Serverless (MySQL 8.0 compatible)
-- Decisions: 1B+Ably, 2A alert SMS (no relay), 3A number-gated, 4A CRM contacts,
-- 5A real-state Twilio acct, 6A People assign+sync, 7B SMS+email notify, 8B Ably,
-- 9B no HELP/STOP auto in v1, 10C admins.phone + call_forwarding_phone

-- ---------------------------------------------------------------------------
-- Admin voice / notify fields (10C)
-- ---------------------------------------------------------------------------
ALTER TABLE `admins`
  ADD COLUMN `voice_available` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Browser softphone registered for inbound on assigned brand line';

ALTER TABLE `admins`
  ADD COLUMN `call_forwarding_enabled` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Also ring personal phone on inbound voice';

ALTER TABLE `admins`
  ADD COLUMN `call_forwarding_phone` VARCHAR(20) DEFAULT NULL
    COMMENT 'E.164 cell for simultaneous ring (voice)';

-- ---------------------------------------------------------------------------
-- Brand Twilio inventory
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- CRM Contacts (address book; convert → clients prospect)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Unknown inbound (cold SMS)
-- ofg_number_id = brand line FK (name kept for Optimum port parity; UI says Groundwork)
-- ---------------------------------------------------------------------------
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
  `data` MEDIUMBLOB NOT NULL,
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

-- Seed Groundwork brand line (562) 573-5110 — assign to Cesar in same migration when present
INSERT INTO `admin_phone_numbers` (`e164`, `friendly_name`, `capabilities_json`, `is_active`)
VALUES (
  '+15625735110',
  'Groundwork Capital — Cesar',
  JSON_OBJECT('sms', TRUE, 'mms', TRUE, 'voice', TRUE),
  1
)
ON DUPLICATE KEY UPDATE
  `friendly_name` = VALUES(`friendly_name`),
  `capabilities_json` = VALUES(`capabilities_json`),
  `is_active` = 1;

-- Assign to Cesar + set personal alert phone + call-forward cell (10C)
UPDATE `admins` a
INNER JOIN `admin_phone_numbers` n ON n.e164 = '+15625735110'
SET
  n.assigned_admin_id = a.id,
  a.phone = '+19513783429',
  a.call_forwarding_phone = '+19513783429',
  a.call_forwarding_enabled = 1
WHERE a.email = 'cesar@optimum-financial-group.com'
  AND a.status = 'active';

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`)
VALUES
  (
    'voice_voicemail_enabled',
    '1',
    'Org default: enable voicemail on assigned brand lines when admin has no override'
  ),
  (
    'voice_voicemail_greeting_text',
    'Hello, you have reached Groundwork Capital. We are unable to take your call right now. Please leave a message after the tone.',
    'Default TTS voicemail greeting'
  ),
  (
    'voice_voicemail_max_seconds',
    '120',
    'Max voicemail recording seconds'
  )
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
