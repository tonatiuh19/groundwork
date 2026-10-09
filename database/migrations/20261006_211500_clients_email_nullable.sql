-- Allow phone-only client prospects (CRM contact convert without email).
-- Matches Optimum Credit: contacts may convert with phone and/or email.
-- UNIQUE(email) still applies; multiple NULLs are allowed in TiDB/MySQL.

ALTER TABLE `clients`
  MODIFY COLUMN `email` VARCHAR(255) DEFAULT NULL;
