-- 1) Deal status (separate from portal account status): editable list, shown on
--    pipeline cards + to the referring affiliate; changes notify the affiliate.
CREATE TABLE IF NOT EXISTS `deal_statuses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `label_en` VARCHAR(80) NOT NULL,
  `label_es` VARCHAR(80) NOT NULL,
  `tone` ENUM('neutral','warn','bad','good') NOT NULL DEFAULT 'warn',
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `deal_statuses` (`label_en`, `label_es`, `tone`, `sort_order`)
SELECT * FROM (
  SELECT 'Credit repair' AS a, 'Reparación de crédito' AS b, 'warn' AS c, 10 AS d UNION ALL
  SELECT 'Not enough equity', 'Equity insuficiente', 'bad', 20 UNION ALL
  SELECT 'Waiting on documents', 'Esperando documentos', 'warn', 30 UNION ALL
  SELECT 'On hold', 'En pausa', 'neutral', 40
) seed WHERE NOT EXISTS (SELECT 1 FROM `deal_statuses`);

ALTER TABLE `clients`
  ADD COLUMN `deal_status_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Deal status (credit repair, not enough equity, …); NULL = none',
  ADD COLUMN `deal_status_changed_at` DATETIME DEFAULT NULL;

ALTER TABLE `clients` ADD KEY `idx_clients_deal_status` (`deal_status_id`);

ALTER TABLE `clients`
  ADD CONSTRAINT `fk_clients_deal_status`
    FOREIGN KEY (`deal_status_id`) REFERENCES `deal_statuses`(`id`) ON DELETE SET NULL;

-- 2) Client updates feed: internal notes, or shared with the referring affiliate
--    (portal + text + email). Status changes are logged here too.
CREATE TABLE IF NOT EXISTS `client_updates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('note','deal_status') NOT NULL DEFAULT 'note',
  `visibility` ENUM('internal','affiliate') NOT NULL DEFAULT 'internal',
  `body` TEXT DEFAULT NULL,
  `deal_status_id` INT UNSIGNED DEFAULT NULL,
  `deal_status_label_en` VARCHAR(80) DEFAULT NULL COMMENT 'Snapshot (status may be renamed later)',
  `deal_status_label_es` VARCHAR(80) DEFAULT NULL,
  `notified_affiliate_id` INT UNSIGNED DEFAULT NULL,
  `notified_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client_updates_client` (`client_id`, `id`),
  CONSTRAINT `fk_client_updates_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_client_updates_status`
    FOREIGN KEY (`deal_status_id`) REFERENCES `deal_statuses`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_client_updates_affiliate`
    FOREIGN KEY (`notified_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_client_updates_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Shared brand line: every super_admin / admin / agent sees its threads and
--    rings on inbound calls (browser softphones; no cell forwarding); the owner
--    (assigned_admin_id) keeps voicemail + default assignment.
ALTER TABLE `admin_phone_numbers`
  ADD COLUMN `is_shared` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Shared line: all super_admin/admin/agent staff';

UPDATE `admin_phone_numbers` SET `is_shared` = 1 WHERE `e164` = '+18668647506';
