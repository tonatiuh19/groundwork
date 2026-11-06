-- City Access agreement v2: Daniel set the homeowner cancellation fee (section 2a) to 10%.
-- Still a draft (approved_at NULL): a super admin approves it after the v2 renderer is deployed.
UPDATE city_partner_agreement_templates
SET body = REPLACE(body, '{{cancellation_fee_pct}}', '10')
WHERE version = 2 AND approved_at IS NULL;
