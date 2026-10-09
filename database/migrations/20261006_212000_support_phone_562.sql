-- Public support phone → brand line +1 562 573 5110 (assigned Twilio number)
UPDATE `system_settings`
SET `setting_value` = '+1 562 573 5110',
    `description` = 'Public-facing support phone (Groundwork brand Twilio line)'
WHERE `setting_key` = 'support_phone';
