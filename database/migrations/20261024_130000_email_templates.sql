-- Templates for email too (Mail composer): channel + subject. Existing rows stay SMS.
ALTER TABLE `conversation_templates` ADD COLUMN `channel` ENUM('sms','email') NOT NULL DEFAULT 'sms' AFTER `title`;
ALTER TABLE `conversation_templates` ADD COLUMN `subject_en` VARCHAR(300) DEFAULT NULL AFTER `channel`;
ALTER TABLE `conversation_templates` ADD COLUMN `subject_es` VARCHAR(300) DEFAULT NULL AFTER `subject_en`;
