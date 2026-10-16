-- Primary brand line: default From for staff SMS/calls and campaigns
-- (ORDER BY is_primary DESC, id ASC). The toll-free (866) 864-7506 replaces
-- (562) 573-5110 as Groundwork's main number; 5110 stays active so replies to
-- older threads still arrive.
ALTER TABLE `admin_phone_numbers`
  ADD COLUMN `is_primary` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Preferred default sending line (staff + campaigns)';

UPDATE `admin_phone_numbers` SET `is_primary` = 1 WHERE `e164` = '+18668647506';
UPDATE `admin_phone_numbers` p
  JOIN `admin_phone_numbers` o ON o.`e164` = '+15625735110'
  SET p.`assigned_admin_id` = o.`assigned_admin_id`
  WHERE p.`e164` = '+18668647506' AND p.`assigned_admin_id` IS NULL;
