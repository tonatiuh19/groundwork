-- Public office address → Newport Beach
UPDATE `system_settings`
   SET `setting_value` = '2717 W Coast Hwy Ste C, Newport Beach, CA 92663',
       `description` = 'Public office address',
       `updated_at` = NOW()
 WHERE `setting_key` = 'office_address';
