-- Affiliate cancelled the platform subscription for the end of the paid month (resumable).
ALTER TABLE `affiliates`
  ADD COLUMN `billing_cancel_at_period_end` TINYINT(1) NOT NULL DEFAULT 0 AFTER `billing_card_exp`;
