-- Lead convert → affiliate / contractor FKs (analogous to leads.client_id).

ALTER TABLE `leads`
  ADD COLUMN `converted_affiliate_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Set when lead converted to affiliate'
    AFTER `client_id`;

ALTER TABLE `leads`
  ADD COLUMN `converted_contractor_id` INT UNSIGNED DEFAULT NULL
    COMMENT 'Set when lead converted to contractor'
    AFTER `converted_affiliate_id`;

ALTER TABLE `leads`
  ADD KEY `idx_leads_converted_affiliate` (`converted_affiliate_id`);

ALTER TABLE `leads`
  ADD KEY `idx_leads_converted_contractor` (`converted_contractor_id`);

ALTER TABLE `leads`
  ADD CONSTRAINT `fk_leads_converted_affiliate`
    FOREIGN KEY (`converted_affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE SET NULL;

ALTER TABLE `leads`
  ADD CONSTRAINT `fk_leads_converted_contractor`
    FOREIGN KEY (`converted_contractor_id`) REFERENCES `contractors`(`id`) ON DELETE SET NULL;
