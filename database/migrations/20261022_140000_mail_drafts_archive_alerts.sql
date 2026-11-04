-- Mail: drafts (CRM, mirrored to Outlook Drafts), Outlook archive folder kept in the CRM,
-- and one-time bell/SMS alerts for email from CRM people. TiDB: one change per ALTER.
ALTER TABLE `mail_messages` MODIFY COLUMN `folder` ENUM('inbox','sent','archive') NOT NULL;
ALTER TABLE `mail_messages` ADD COLUMN `alerted_at` DATETIME DEFAULT NULL AFTER `sent_by_admin_id`;

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
