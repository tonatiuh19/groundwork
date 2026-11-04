-- Event / social-QR signups get "Reply A (Homeowner), B (Affiliate / Partner), C (Contractor)".
-- Their answer is stored and they get the right application link (prefilled via role_token).
ALTER TABLE `leads` ADD COLUMN `role_token` CHAR(32) DEFAULT NULL;
ALTER TABLE `leads` ADD COLUMN `role_prompt_sent_at` DATETIME DEFAULT NULL;
ALTER TABLE `leads` ADD COLUMN `role_answer` ENUM('homeowner','partner','contractor') DEFAULT NULL;
ALTER TABLE `leads` ADD COLUMN `role_answered_at` DATETIME DEFAULT NULL;
ALTER TABLE `leads` ADD UNIQUE KEY `uq_leads_role_token` (`role_token`);
