-- Extend leads for get-credit-report capture (OFG-parity fields).
-- Idempotent: safe to re-run on TiDB / MySQL 8.

ALTER TABLE `leads`
  MODIFY COLUMN `property_address` VARCHAR(500) DEFAULT NULL;

SET @db := DATABASE();

SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'first_name'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `leads` ADD COLUMN `first_name` VARCHAR(100) DEFAULT NULL AFTER `id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'last_name'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `leads` ADD COLUMN `last_name` VARCHAR(100) DEFAULT NULL AFTER `first_name`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'preferred_language'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `leads` ADD COLUMN `preferred_language` ENUM(''en'',''es'') NOT NULL DEFAULT ''en'' AFTER `source`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'notes'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `leads` ADD COLUMN `notes` TEXT DEFAULT NULL AFTER `preferred_language`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `leads`
SET
  `first_name` = COALESCE(
    `first_name`,
    NULLIF(SUBSTRING_INDEX(TRIM(`full_name`), ' ', 1), '')
  ),
  `last_name` = COALESCE(
    `last_name`,
    NULLIF(
      TRIM(SUBSTRING(`full_name`, LENGTH(SUBSTRING_INDEX(TRIM(`full_name`), ' ', 1)) + 2)),
      ''
    )
  )
WHERE `full_name` IS NOT NULL AND TRIM(`full_name`) <> '';
