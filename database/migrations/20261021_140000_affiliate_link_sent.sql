-- When the affiliate last received their referral link (approval email + text, or a staff resend).
ALTER TABLE `affiliates`
  ADD COLUMN `link_sent_at` DATETIME DEFAULT NULL COMMENT 'Last time the referral-link welcome (email + SMS) was sent';
