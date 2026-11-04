-- Staff notification routing: each area goes to chosen staff (+ the record's assigned
-- staff member). Areas without a row go to super admins only. Personal prefs still
-- decide the channels (email / bell / SMS).
CREATE TABLE IF NOT EXISTS `notify_routing` (
  `area` VARCHAR(40) NOT NULL,
  `admin_ids_json` JSON NOT NULL,
  `include_owner` TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Also the record''s assigned staff member',
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`area`),
  CONSTRAINT `fk_notify_routing_admin` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
