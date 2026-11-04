-- Dynamic QR codes (canopy banners, flyers): a permanent /go/{slug} short link whose
-- destination staff can change anytime from Admin -> QR codes. Printed codes never change.
CREATE TABLE IF NOT EXISTS `qr_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(64) NOT NULL COMMENT 'Permanent: printed into the QR as /go/{slug}',
  `label` VARCHAR(160) NOT NULL,
  `destination_url` VARCHAR(1000) NOT NULL COMMENT 'Site path (/e/...) or full https URL',
  `active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = scans land on the home page',
  `scan_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_scanned_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_qr_links_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
