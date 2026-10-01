-- Prevent duplicate event RSVPs (same email + event).
-- Standard leads keep event_id NULL; MySQL/TiDB allow multiple NULLs in a UNIQUE key.

ALTER TABLE `leads`
  ADD UNIQUE KEY `uq_leads_email_event` (`email`, `event_id`);
