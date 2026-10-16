#!/usr/bin/env bash
# Local dev with real Stripe TEST-mode webhooks (no real email/SMS: NOTIFY_SANDBOX).
# Pair with: stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to https://localhost:8080/api/webhooks/billing --skip-verify
set -euo pipefail
KEY=$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)
case "$KEY" in sk_test_*) ;; *) echo "dev-stripe: STRIPE_SECRET_KEY must be a test-mode key" >&2; exit 1 ;; esac
export STRIPE_WEBHOOK_SECRET="$(stripe listen --api-key "$KEY" --print-secret)"
export NOTIFY_SANDBOX=true
exec npm run dev
