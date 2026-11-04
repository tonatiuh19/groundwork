-- Sign-in records the last login on every portal's people table (same as admins, affiliates, contractors, clients).
ALTER TABLE `city_partners` ADD COLUMN IF NOT EXISTS `last_login_at` DATETIME DEFAULT NULL;
