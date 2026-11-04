-- Microsoft 365 mailboxes connected to the CRM (Graph, app-only auth in the Encore tenant).
-- Mail (Inbox + Sent) syncs into mail_threads / mail_messages; calendars sync both ways
-- with appointments through appointment_calendar_links.

CREATE TABLE IF NOT EXISTS `mailboxes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(200) DEFAULT NULL,
  `kind` ENUM('personal','shared') NOT NULL DEFAULT 'personal',
  `owner_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Personal mailbox owner (calendar owner for appointments)',
  `status` ENUM('active','paused','error') NOT NULL DEFAULT 'active',
  `mail_sync_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `calendar_sync_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `mail_delta_inbox` TEXT DEFAULT NULL COMMENT 'Graph delta/next link for Inbox',
  `mail_delta_sent` TEXT DEFAULT NULL COMMENT 'Graph delta/next link for Sent Items',
  `signature_html` TEXT DEFAULT NULL,
  `last_mail_sync_at` DATETIME DEFAULT NULL,
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
  `folder` ENUM('inbox','sent') NOT NULL,
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
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mail_messages_graph` (`mailbox_id`, `graph_id`),
  KEY `idx_mail_messages_thread` (`thread_id`, `sent_at`),
  KEY `idx_mail_messages_from` (`from_email`),
  CONSTRAINT `fk_mail_messages_mailbox` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mail_messages_thread` FOREIGN KEY (`thread_id`) REFERENCES `mail_threads`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mail_messages_admin` FOREIGN KEY (`sent_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- TiDB: one schema change per ALTER.
ALTER TABLE `appointments` MODIFY COLUMN `source` ENUM('staff','booking','outlook') NOT NULL DEFAULT 'staff';
ALTER TABLE `appointments` ADD COLUMN `teams_meeting` TINYINT(1) NOT NULL DEFAULT 0 AFTER `video_url`;
ALTER TABLE `appointments` ADD COLUMN `show_as` ENUM('busy','free','tentative','oof','workingElsewhere','unknown') NOT NULL DEFAULT 'busy' AFTER `teams_meeting`;
