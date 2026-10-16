-- Explicit line mode (no more "a line with members is shared" guessing):
--   shared   → members see it + ring list (Phone line settings)
--   personal → one staff owner rings; visible to the owner + all admins; when the
--              owner is deactivated it falls back to the main shared line's team.
ALTER TABLE `admin_phone_numbers`
  ADD COLUMN `line_mode` ENUM('shared','personal') NOT NULL DEFAULT 'personal'
    COMMENT 'shared = members + ring list; personal = one staff owner';

UPDATE `admin_phone_numbers` n
SET n.`line_mode` = 'shared'
WHERE n.`is_primary` = 1
   OR EXISTS (SELECT 1 FROM `phone_line_members` m WHERE m.`line_id` = n.`id`);
