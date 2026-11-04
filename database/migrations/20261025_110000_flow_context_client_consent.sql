-- Flow run context (links minted once per run, last reply) + homeowner text consent on clients.
ALTER TABLE `reminder_flow_runs` ADD COLUMN `context_json` JSON DEFAULT NULL;
ALTER TABLE `reminder_flow_runs` ADD COLUMN `last_reply_at` DATETIME DEFAULT NULL;
ALTER TABLE `clients` ADD COLUMN `sms_marketing_consent` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'OK to text (automatic follow-ups)';
