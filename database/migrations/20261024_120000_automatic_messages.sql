-- Every automatic email / text sent to a CRM person (welcome, approval, invites, reminders…):
-- listed on their record and logged in their Conversations thread.
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
