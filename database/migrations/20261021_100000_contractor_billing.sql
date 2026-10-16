-- Contractor platform membership ($99.90/mo, 30 days free) + approval-gated trials.
-- The card is saved during the application / onboarding; the subscription (and
-- its free period) starts only once the person is approved (status = 'active').

ALTER TABLE `contractors`
  ADD COLUMN `subscription_price_cents` INT UNSIGNED DEFAULT NULL
    COMMENT 'Monthly platform price override; NULL = default setting, 0 = waived',
  ADD COLUMN `billing_customer_id` VARCHAR(64) DEFAULT NULL COMMENT 'Payment processor customer id',
  ADD COLUMN `billing_subscription_id` VARCHAR(64) DEFAULT NULL COMMENT 'Payment processor subscription id',
  ADD COLUMN `billing_payment_method_id` VARCHAR(64) DEFAULT NULL COMMENT 'Saved card (subscription starts on approval)',
  ADD COLUMN `billing_status` ENUM('none','trialing','active','past_due','canceled','incomplete') NOT NULL DEFAULT 'none',
  ADD COLUMN `billing_trial_ends_at` DATETIME DEFAULT NULL,
  ADD COLUMN `billing_current_period_end` DATETIME DEFAULT NULL,
  ADD COLUMN `billing_card_brand` VARCHAR(20) DEFAULT NULL,
  ADD COLUMN `billing_card_last4` CHAR(4) DEFAULT NULL,
  ADD COLUMN `billing_card_exp` VARCHAR(7) DEFAULT NULL COMMENT 'MM/YYYY',
  ADD COLUMN `billing_cancel_at_period_end` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `billing_updated_at` DATETIME DEFAULT NULL;

ALTER TABLE `contractors` ADD KEY `idx_contractors_billing_customer` (`billing_customer_id`);
ALTER TABLE `contractors` ADD KEY `idx_contractors_billing_subscription` (`billing_subscription_id`);

ALTER TABLE `affiliates`
  ADD COLUMN `billing_payment_method_id` VARCHAR(64) DEFAULT NULL COMMENT 'Saved card (subscription starts on approval)';

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('contractor_default_price_cents', '9990', 'Monthly platform membership for contractors (cents)'),
  ('contractor_trial_days', '30', 'Free days after approval before the contractor membership charges')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
