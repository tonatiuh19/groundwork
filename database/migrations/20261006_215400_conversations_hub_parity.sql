-- Conversations hub parity: admin voicemail overrides + MMS blob-friendly storage

ALTER TABLE `admins`
  ADD COLUMN `voicemail_enabled` TINYINT(1) DEFAULT NULL
    COMMENT 'NULL = inherit org default from system_settings';

ALTER TABLE `admins`
  ADD COLUMN `voicemail_greeting_text` TEXT DEFAULT NULL;

ALTER TABLE `admins`
  ADD COLUMN `voicemail_greeting_url` VARCHAR(500) DEFAULT NULL;

-- Prefer Vercel Blob URL in cdn_url; allow null local blob when bytes live on Blob
ALTER TABLE `mms_media`
  MODIFY COLUMN `data` MEDIUMBLOB NULL;

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`)
VALUES
  (
    'twilio_twiml_app_sid',
    '',
    'Cached Twilio TwiML App SID for Conversations softphone (auto-created when empty)'
  )
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
