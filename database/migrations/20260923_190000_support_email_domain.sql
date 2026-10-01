-- Align public support email with production domain (groundworkcapitalgroup.com).
UPDATE `system_settings`
SET `setting_value` = 'hello@groundworkcapitalgroup.com',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `setting_key` = 'support_email';
