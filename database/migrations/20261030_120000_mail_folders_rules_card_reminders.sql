-- Mail: real Outlook folders (synced), CRM mail rules. Affiliates: automatic add-your-card reminders.
ALTER TABLE `mail_messages` MODIFY COLUMN `folder` ENUM('inbox','sent','archive','custom') NOT NULL;
ALTER TABLE `mail_messages` ADD COLUMN IF NOT EXISTS `mail_folder_id` INT UNSIGNED DEFAULT NULL COMMENT 'Set when folder = custom';
ALTER TABLE `mail_messages` ADD INDEX IF NOT EXISTS `idx_mail_messages_folder` (`mail_folder_id`, `thread_id`);
ALTER TABLE `mail_threads` ADD COLUMN IF NOT EXISTS `filed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Inbound mail filed in a custom folder, none left in Inbox';
ALTER TABLE `mailboxes` ADD COLUMN IF NOT EXISTS `mail_folders_synced_at` DATETIME DEFAULT NULL;

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

ALTER TABLE `affiliates` ADD COLUMN IF NOT EXISTS `card_reminder_count` TINYINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE `affiliates` ADD COLUMN IF NOT EXISTS `card_reminder_last_at` DATETIME DEFAULT NULL;
