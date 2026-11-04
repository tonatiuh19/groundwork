-- Lines removed from the CRM (kept in Twilio until released there). Threads stay, read-only.
ALTER TABLE `admin_phone_numbers` ADD COLUMN `removed_at` DATETIME DEFAULT NULL;
