-- Go-live (live payment keys): clear card/subscription ids left over from the test-mode
-- account so nobody hits "No such customer". Members add a real card on their next visit.
-- Also resets test-mode free-period flags so the real free period is still available.
-- Only touches rows that still carry a payment id; names, emails and history are untouched.
UPDATE affiliates
SET billing_customer_id = NULL, billing_subscription_id = NULL, billing_payment_method_id = NULL,
    billing_status = 'none', billing_trial_ends_at = NULL, billing_current_period_end = NULL,
    billing_card_brand = NULL, billing_card_last4 = NULL, billing_card_exp = NULL,
    billing_cancel_at_period_end = 0, billing_trial_used_at = NULL,
    billing_trial_reminder_sent_at = NULL, billing_expiry_notice = NULL, billing_updated_at = NOW()
WHERE billing_customer_id IS NOT NULL OR billing_subscription_id IS NOT NULL OR billing_payment_method_id IS NOT NULL;

UPDATE contractors
SET billing_customer_id = NULL, billing_subscription_id = NULL, billing_payment_method_id = NULL,
    billing_status = 'none', billing_trial_ends_at = NULL, billing_current_period_end = NULL,
    billing_card_brand = NULL, billing_card_last4 = NULL, billing_card_exp = NULL,
    billing_cancel_at_period_end = 0, billing_trial_used_at = NULL,
    billing_trial_reminder_sent_at = NULL, billing_expiry_notice = NULL, billing_updated_at = NOW()
WHERE billing_customer_id IS NOT NULL OR billing_subscription_id IS NOT NULL OR billing_payment_method_id IS NOT NULL;
