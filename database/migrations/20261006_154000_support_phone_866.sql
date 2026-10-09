-- Public support phone → toll-free +1 866 864 7506
UPDATE `system_settings`
SET `setting_value` = '+1 866 864 7506',
    `description` = 'Public-facing support phone'
WHERE `setting_key` = 'support_phone';
