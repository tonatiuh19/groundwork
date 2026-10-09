-- Freeze commission $/sqft rates on the project at first accrual (not live Settings on unpaid recalc).
-- Split ALTERs for TiDB compatibility.

ALTER TABLE `projects`
  ADD COLUMN `commission_rate_direct_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen direct $/sqft cents at accrual'
    AFTER `commission_override_cents`;

ALTER TABLE `projects`
  ADD COLUMN `commission_rate_closer_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen closer $/sqft cents at accrual'
    AFTER `commission_rate_direct_cents_per_sqft`;

ALTER TABLE `projects`
  ADD COLUMN `commission_rate_parent_cents_per_sqft` INT UNSIGNED DEFAULT NULL
    COMMENT 'Frozen parent $/sqft cents at accrual'
    AFTER `commission_rate_closer_cents_per_sqft`;
