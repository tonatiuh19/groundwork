-- Retire (562) 573-5110 from Groundwork: the toll-free (866) 864-7506 is the only
-- brand line. Threads + unknown contacts move to the 866 so staff keep access and
-- replies go out from the new number; 5110 is deactivated and unassigned (its
-- Twilio webhooks are cleared separately; the number itself is not released).
UPDATE `conversations` c
  JOIN `admin_phone_numbers` o ON o.`id` = c.`ofg_number_id` AND o.`e164` = '+15625735110'
  JOIN `admin_phone_numbers` n ON n.`e164` = '+18668647506'
  SET c.`ofg_number_id` = n.`id`;

UPDATE `conversation_unknown_contacts` u
  JOIN `admin_phone_numbers` o ON o.`id` = u.`ofg_number_id` AND o.`e164` = '+15625735110'
  JOIN `admin_phone_numbers` n ON n.`e164` = '+18668647506'
  SET u.`ofg_number_id` = n.`id`;

UPDATE `admin_phone_numbers`
  SET `is_active` = 0, `is_primary` = 0, `assigned_admin_id` = NULL
  WHERE `e164` = '+15625735110';
