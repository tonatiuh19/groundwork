-- Card updates: remember that the one free period was used (survives a processor
-- customer reset), and which card-expiry reminder was last sent.

ALTER TABLE `affiliates`
  ADD COLUMN `billing_trial_used_at` DATETIME DEFAULT NULL COMMENT 'Free period granted (once per person)',
  ADD COLUMN `billing_expiry_notice` VARCHAR(16) DEFAULT NULL COMMENT 'Last card-expiry reminder sent: MM/YYYY:30 or MM/YYYY:7';

ALTER TABLE `contractors`
  ADD COLUMN `billing_trial_used_at` DATETIME DEFAULT NULL COMMENT 'Free period granted (once per person)',
  ADD COLUMN `billing_expiry_notice` VARCHAR(16) DEFAULT NULL COMMENT 'Last card-expiry reminder sent: MM/YYYY:30 or MM/YYYY:7';

UPDATE `affiliates` SET `billing_trial_used_at` = COALESCE(`billing_updated_at`, NOW())
  WHERE `billing_subscription_id` IS NOT NULL AND `billing_trial_used_at` IS NULL;
UPDATE `contractors` SET `billing_trial_used_at` = COALESCE(`billing_updated_at`, NOW())
  WHERE `billing_subscription_id` IS NOT NULL AND `billing_trial_used_at` IS NULL;
