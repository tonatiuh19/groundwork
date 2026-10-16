-- Staff edit panel: email changes (sign-in identity) are audited with old → new.
ALTER TABLE `people_dedupe_log`
  MODIFY COLUMN `action` ENUM('merge','delete','phone_override','link','dismiss','blocked','revert','email_change') NOT NULL;
