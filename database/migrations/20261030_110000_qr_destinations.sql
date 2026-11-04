-- QR codes: destinations picked from known records (never typed), a fallback per code, archiving,
-- approved external links, daily scans per destination, change history, and first-touch credit.
ALTER TABLE `qr_links` ADD COLUMN IF NOT EXISTS `dest_type` ENUM('page','event','next_event','affiliate','external') NOT NULL DEFAULT 'page' AFTER `destination_url`;
ALTER TABLE `qr_links` ADD COLUMN IF NOT EXISTS `dest_key` VARCHAR(40) DEFAULT NULL COMMENT 'page key; NULL page = older code using destination_url' AFTER `dest_type`;
ALTER TABLE `qr_links` ADD COLUMN IF NOT EXISTS `dest_id` INT UNSIGNED DEFAULT NULL COMMENT 'event, affiliate or external link id' AFTER `dest_key`;
ALTER TABLE `qr_links` ADD COLUMN IF NOT EXISTS `fallback_type` ENUM('page','event','next_event','affiliate','external') DEFAULT NULL COMMENT 'NULL = home page' AFTER `dest_id`;
ALTER TABLE `qr_links` ADD COLUMN IF NOT EXISTS `fallback_key` VARCHAR(40) DEFAULT NULL AFTER `fallback_type`;
ALTER TABLE `qr_links` ADD COLUMN IF NOT EXISTS `fallback_id` INT UNSIGNED DEFAULT NULL AFTER `fallback_key`;
ALTER TABLE `qr_links` ADD COLUMN IF NOT EXISTS `archived_at` DATETIME DEFAULT NULL AFTER `active`;

CREATE TABLE IF NOT EXISTS `qr_external_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `label` VARCHAR(160) NOT NULL,
  `url` VARCHAR(1000) NOT NULL COMMENT 'https only, checked when saved',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qr_link_daily` (
  `qr_link_id` INT UNSIGNED NOT NULL,
  `day` DATE NOT NULL COMMENT 'Pacific',
  `dest_ref` VARCHAR(64) NOT NULL COMMENT 'page:home, event:12, next_event, ...',
  `dest_label` VARCHAR(200) NOT NULL,
  `scans` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`qr_link_id`, `day`, `dest_ref`),
  CONSTRAINT `fk_qr_daily_link` FOREIGN KEY (`qr_link_id`) REFERENCES `qr_links` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qr_link_changes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `qr_link_id` INT UNSIGNED NOT NULL,
  `action` ENUM('created','destination','fallback','label','on','off','archived','restored') NOT NULL,
  `before_text` VARCHAR(300) DEFAULT NULL,
  `after_text` VARCHAR(300) DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_qr_changes_link` (`qr_link_id`, `id`),
  CONSTRAINT `fk_qr_changes_link` FOREIGN KEY (`qr_link_id`) REFERENCES `qr_links` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `qr_link_id` INT UNSIGNED DEFAULT NULL COMMENT 'First QR code scanned before this record';
ALTER TABLE `leads` ADD INDEX IF NOT EXISTS `idx_leads_qr_link` (`qr_link_id`);
ALTER TABLE `clients` ADD COLUMN IF NOT EXISTS `qr_link_id` INT UNSIGNED DEFAULT NULL COMMENT 'First QR code scanned before this record';
ALTER TABLE `clients` ADD INDEX IF NOT EXISTS `idx_clients_qr_link` (`qr_link_id`);
ALTER TABLE `affiliates` ADD COLUMN IF NOT EXISTS `qr_link_id` INT UNSIGNED DEFAULT NULL COMMENT 'First QR code scanned before this record';
ALTER TABLE `affiliates` ADD INDEX IF NOT EXISTS `idx_affiliates_qr_link` (`qr_link_id`);
ALTER TABLE `contractors` ADD COLUMN IF NOT EXISTS `qr_link_id` INT UNSIGNED DEFAULT NULL COMMENT 'First QR code scanned before this record';
ALTER TABLE `contractors` ADD INDEX IF NOT EXISTS `idx_contractors_qr_link` (`qr_link_id`);
