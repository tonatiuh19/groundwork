-- Archived cities stay as history but disappear from pickers, filters and the pipeline.
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `archived_at` DATETIME DEFAULT NULL;
