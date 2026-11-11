-- Void & re-issue a City Partner agreement (e.g. rate change after signing): the voided copy is kept
-- with who voided it and why; the partner then signs a new one at the new rate.
ALTER TABLE city_partner_agreements
  ADD COLUMN void_reason VARCHAR(500) DEFAULT NULL AFTER voided_at;
ALTER TABLE city_partner_agreements
  ADD COLUMN voided_by_admin_id INT UNSIGNED DEFAULT NULL AFTER void_reason;
