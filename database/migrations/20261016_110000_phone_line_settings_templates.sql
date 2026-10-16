-- Phone line settings (one place per line): who sees it, what rings, one
-- bilingual voicemail. Replaces the role-based `is_shared` flag from
-- 20261016_100000 (never deployed) with explicit members.

-- 1) Members: staff who see the line's conversations / call history; ring_browser
--    = their CRM softphone rings on inbound calls.
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

-- 2) Extra phones that ring (cells). Always screened ("press 1 to accept") so a
--    personal voicemail can never answer a Groundwork call.
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

-- 3) Line-level call behaviour.
ALTER TABLE `admin_phone_numbers`
  ADD COLUMN `ring_timeout_sec` INT UNSIGNED NOT NULL DEFAULT 25
    COMMENT 'Seconds to ring before voicemail',
  ADD COLUMN `voicemail_greeting_en` TEXT DEFAULT NULL
    COMMENT 'Line voicemail greeting (English); NULL = system default',
  ADD COLUMN `voicemail_greeting_es` TEXT DEFAULT NULL
    COMMENT 'Line voicemail greeting (Spanish); NULL = system default';

-- Seed the 866: every active super_admin/admin/agent is a member (browser rings),
-- and the owner's current cell forwarding becomes a screened ring number.
INSERT IGNORE INTO `phone_line_members` (`line_id`, `admin_id`, `ring_browser`)
SELECT n.id, a.id, 1
FROM `admin_phone_numbers` n
JOIN `admins` a ON a.status = 'active' AND a.role IN ('super_admin','admin','agent')
  AND a.email NOT LIKE '%@example.com' AND a.email NOT LIKE '%@example.test'
WHERE n.e164 = '+18668647506' AND n.is_shared = 1;

INSERT IGNORE INTO `phone_line_ring_numbers` (`line_id`, `label`, `e164`, `sort_order`)
SELECT n.id, CONCAT(a.first_name, ' (cell)'), COALESCE(a.call_forwarding_phone, a.phone), 10
FROM `admin_phone_numbers` n
JOIN `admins` a ON a.id = n.assigned_admin_id
WHERE n.e164 = '+18668647506' AND a.call_forwarding_enabled = 1
  AND COALESCE(a.call_forwarding_phone, a.phone) IS NOT NULL;

ALTER TABLE `admin_phone_numbers` DROP COLUMN `is_shared`;

-- 4) SMS templates (real-state style): category, usage tracking.
ALTER TABLE `conversation_templates`
  ADD COLUMN `category` ENUM('general','welcome','follow_up','reminder','status_update','documents','scheduling')
    NOT NULL DEFAULT 'general',
  ADD COLUMN `usage_count` INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `last_used_at` DATETIME DEFAULT NULL;
