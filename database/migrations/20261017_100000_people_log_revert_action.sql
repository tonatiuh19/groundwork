-- "Move back to Leads" (undo a client conversion) is audited in people_dedupe_log
-- with a full snapshot of the removed client, project(s) and notes.
ALTER TABLE `people_dedupe_log`
  MODIFY COLUMN `action` ENUM('merge','delete','phone_override','link','dismiss','blocked','revert') NOT NULL;
