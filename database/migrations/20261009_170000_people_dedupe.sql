-- People de-duplication: one role per person (client | affiliate | contractor),
-- matched by email OR phone (last 10 digits). Repeat public submissions merge
-- into one lead. Staff tools merge / delete / dismiss duplicates (audited).

ALTER TABLE `leads`
  ADD COLUMN `submission_count` INT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Public submissions merged into this lead (repeat forms bump it)',
  ADD COLUMN `last_submitted_at` DATETIME DEFAULT NULL
    COMMENT 'Latest merged submission; list sorts by COALESCE(last_submitted_at, created_at)';

-- Audit trail for merges, deletes, phone overrides, links and dismissals.
CREATE TABLE IF NOT EXISTS `people_dedupe_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `action` ENUM('merge','delete','phone_override','link','dismiss','blocked') NOT NULL,
  `entity` ENUM('lead','client','affiliate','contractor') NOT NULL,
  `record_id` BIGINT UNSIGNED DEFAULT NULL,
  `target_entity` ENUM('lead','client','affiliate','contractor') DEFAULT NULL,
  `target_id` BIGINT UNSIGNED DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `snapshot_json` JSON DEFAULT NULL COMMENT 'Removed record + moved reference counts',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dedupe_log_record` (`entity`, `record_id`),
  KEY `idx_dedupe_log_created` (`created_at`),
  CONSTRAINT `fk_dedupe_log_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Not duplicates" decisions (e.g. a household sharing one phone). Signature =
-- sorted member keys of the cluster ("client:12|client:40"); a new member
-- changes the signature, so the cluster resurfaces for review.
CREATE TABLE IF NOT EXISTS `people_dedupe_dismissals` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `signature` VARCHAR(500) NOT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dedupe_dismissal_sig` (`signature`),
  CONSTRAINT `fk_dedupe_dismissal_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: link existing leads to the person they already are (email first, then phone).
UPDATE `leads` l
  INNER JOIN `affiliates` a ON LOWER(a.email) = LOWER(l.email)
  SET l.converted_affiliate_id = a.id
  WHERE l.converted_affiliate_id IS NULL;
UPDATE `leads` l
  INNER JOIN `contractors` k ON LOWER(k.email) = LOWER(l.email)
  SET l.converted_contractor_id = k.id
  WHERE l.converted_contractor_id IS NULL;
UPDATE `leads` l
  INNER JOIN `clients` c ON c.email IS NOT NULL AND LOWER(c.email) = LOWER(l.email)
  SET l.client_id = c.id
  WHERE l.client_id IS NULL;
UPDATE `leads` l
  INNER JOIN `affiliates` a
    ON a.phone IS NOT NULL
   AND LENGTH(RIGHT(REGEXP_REPLACE(a.phone, '[^0-9]', ''), 10)) = 10
   AND RIGHT(REGEXP_REPLACE(a.phone, '[^0-9]', ''), 10) = RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', ''), 10)
  SET l.converted_affiliate_id = a.id
  WHERE l.converted_affiliate_id IS NULL AND l.client_id IS NULL AND l.converted_contractor_id IS NULL;
UPDATE `leads` l
  INNER JOIN `contractors` k
    ON k.phone IS NOT NULL
   AND LENGTH(RIGHT(REGEXP_REPLACE(k.phone, '[^0-9]', ''), 10)) = 10
   AND RIGHT(REGEXP_REPLACE(k.phone, '[^0-9]', ''), 10) = RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', ''), 10)
  SET l.converted_contractor_id = k.id
  WHERE l.converted_affiliate_id IS NULL AND l.client_id IS NULL AND l.converted_contractor_id IS NULL;
UPDATE `leads` l
  INNER JOIN `clients` c
    ON c.phone IS NOT NULL
   AND LENGTH(RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10)) = 10
   AND RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10) = RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', ''), 10)
  SET l.client_id = c.id
  WHERE l.converted_affiliate_id IS NULL AND l.client_id IS NULL AND l.converted_contractor_id IS NULL;
