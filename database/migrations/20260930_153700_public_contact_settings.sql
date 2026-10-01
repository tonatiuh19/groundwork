-- Public contact details + lead taxonomy for contact / partner forms.
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`)
VALUES
  ('support_email', 'info@groundworkcapitalgroup.com', 'Public-facing support email'),
  ('support_phone', '(949) 239-6358', 'Public-facing support phone'),
  ('office_address', '1234 Horizon Avenue, San Diego, CA 92121', 'Public office address')
ON DUPLICATE KEY UPDATE
  `setting_value` = VALUES(`setting_value`),
  `description` = VALUES(`description`),
  `updated_at` = CURRENT_TIMESTAMP;
