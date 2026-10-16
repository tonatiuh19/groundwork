import { createSlice, isRejected } from "@reduxjs/toolkit";
import type {
  AdminAffiliateOnboarding,
  AffiliateAgreementSignBody,
  AffiliateAgreementTemplateResponse,
  AffiliateBilling,
  AffiliateOnboardingResponse,
  AffiliateW9Body,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

// ── Affiliate portal ─────────────────────────────────────────────────────────
export const fetchAffiliateOnboarding = createApiThunk<AffiliateOnboardingResponse, "en" | "es">(
  "affiliateOnboarding/fetch",
  "affiliate",
  async (lang) => (await api.get("/affiliate/onboarding", { params: { lang } })).data,
);

export const signAffiliateAgreement = createApiThunk<AffiliateOnboardingResponse, AffiliateAgreementSignBody>(
  "affiliateOnboarding/sign",
  "affiliate",
  async (body) => (await api.post("/affiliate/onboarding/agreement", body)).data,
);

export const submitAffiliateW9 = createApiThunk<AffiliateOnboardingResponse, AffiliateW9Body>(
  "affiliateOnboarding/w9",
  "affiliate",
  async (body) => (await api.post("/affiliate/onboarding/w9", body)).data,
);

// ── Card on file (step 3) ───────────────────────────────────────────────────
/** One-time setup secret for the card form (the card itself never touches our servers). */
export const startCardSetup = createApiThunk<{ client_secret: string }, void>(
  "affiliateOnboarding/cardSetup",
  "affiliate",
  async () => (await api.post("/affiliate/onboarding/billing/setup")).data,
);

/** After the browser confirms the card: make it default and start (or update) the plan. */
export const activateCard = createApiThunk<{ billing: AffiliateBilling }, { setup_intent_id: string }>(
  "affiliateOnboarding/cardActivate",
  "affiliate",
  async (body) => (await api.post("/affiliate/onboarding/billing/activate", body)).data,
);

export const setBillingCancel = createApiThunk<{ billing: AffiliateBilling }, { resume: boolean }>(
  "affiliateOnboarding/billingCancel",
  "affiliate",
  async (body) => (await api.post("/affiliate/billing/cancel", body)).data,
);

// ── Admin ────────────────────────────────────────────────────────────────────
/** Portal: membership + whether the portal is paused for a failed payment. */
export const fetchAffiliateBillingStatus = createApiThunk<{ billing: AffiliateBilling; locked: boolean }, void>(
  "affiliateOnboarding/billingStatus",
  "affiliate",
  async () => (await api.get("/affiliate/billing/status")).data,
);

/** Staff: affiliates who signed an older agreement version + ask them to re-sign. */
export const fetchOutdatedAgreements = createApiThunk<{ current_version: number | null; count: number }, void>(
  "affiliateOnboarding/outdated",
  "admin",
  async () => (await api.get("/admin/affiliate-agreement/outdated")).data,
);
export const sendResignNotice = createApiThunk<{ sent: number; current_version: number | null }, void>(
  "affiliateOnboarding/resignNotice",
  "admin",
  async () => (await api.post("/admin/affiliate-agreement/resign-notice", { confirm: true })).data,
);

export const fetchAdminAffiliateBilling = createApiThunk<{ billing: AffiliateBilling }, number>(
  "affiliateOnboarding/adminBilling",
  "admin",
  async (id) => (await api.get(`/admin/affiliates/${id}/billing`)).data,
);

export const resendAffiliateWelcome = createApiThunk<{ ok: true }, number>(
  "affiliateOnboarding/resendWelcome",
  "admin",
  async (id) => (await api.post(`/admin/affiliates/${id}/welcome`)).data,
);
export const fetchAdminAffiliateOnboarding = createApiThunk<AdminAffiliateOnboarding, number>(
  "affiliateOnboarding/adminFetch",
  "admin",
  async (id) => (await api.get(`/admin/affiliates/${id}/onboarding`)).data,
);

export const setAffiliateSubscriptionPrice = createApiThunk<
  { emailed: boolean },
  { id: number; subscription_price_cents: number | null }
>("affiliateOnboarding/setPrice", "admin", async ({ id, subscription_price_cents }) => {
  return (await api.patch(`/admin/affiliates/${id}/subscription-price`, { subscription_price_cents })).data;
});

export const voidAffiliateAgreement = createApiThunk<unknown, { id: number; agreementId: number; reason: string }>(
  "affiliateOnboarding/void",
  "admin",
  async ({ id, agreementId, reason }) =>
    (await api.post(`/admin/affiliates/${id}/agreements/${agreementId}/void`, { reason })).data,
);

export const reviewAffiliateW9 = createApiThunk<
  unknown,
  { id: number; w9Id: number; status: "accepted" | "rejected"; note?: string }
>("affiliateOnboarding/reviewW9", "admin", async ({ id, w9Id, ...body }) =>
  (await api.post(`/admin/affiliates/${id}/w9s/${w9Id}/review`, body)).data,
);

export const fetchAgreementTemplate = createApiThunk<AffiliateAgreementTemplateResponse, void>(
  "affiliateOnboarding/template",
  "admin",
  async () => (await api.get("/admin/affiliate-agreement/template")).data,
);

export const publishAgreementTemplate = createApiThunk<
  AffiliateAgreementTemplateResponse,
  { body_en: string; body_es: string; notes?: string }
>("affiliateOnboarding/publishTemplate", "admin", async (body) =>
  (await api.post("/admin/affiliate-agreement/template", body)).data,
);

type State = {
  portal: AffiliateOnboardingResponse | null;
  portalLoading: boolean;
  portalError: string | null;
  submitting: boolean;
  submitError: string | null;
  admin: AdminAffiliateOnboarding | null;
  /** Affiliate id `admin` belongs to (avoid showing another record while loading). */
  adminFor: number | null;
  adminLoading: boolean;
  adminError: string | null;
  adminSaving: boolean;
  template: AffiliateAgreementTemplateResponse | null;
  templateSaving: boolean;
  templateError: string | null;
  cardBusy: boolean;
  cardError: string | null;
  adminBilling: AffiliateBilling | null;
  adminBillingFor: number | null;
  /** Signed-in portal: membership + pause state (failed payment). */
  status: AffiliateBilling | null;
  locked: boolean;
  outdated: { current_version: number | null; count: number } | null;
  resignSending: boolean;
  resignSent: number | null;
};

const initialState: State = {
  portal: null,
  portalLoading: false,
  portalError: null,
  submitting: false,
  submitError: null,
  admin: null,
  adminFor: null,
  adminLoading: false,
  adminError: null,
  adminSaving: false,
  template: null,
  templateSaving: false,
  templateError: null,
  cardBusy: false,
  cardError: null,
  adminBilling: null,
  adminBillingFor: null,
  status: null,
  locked: false,
  outdated: null,
  resignSending: false,
  resignSent: null,
};

const slice = createSlice({
  name: "affiliateOnboarding",
  initialState,
  reducers: {
    /** Card form errors come from the browser-side confirmation too. */
    setCardError(s, a: { payload: string | null }) {
      s.cardError = a.payload;
    },
    clearOnboardingErrors(s) {
      s.cardError = null;
      s.submitError = null;
      s.adminError = null;
      s.templateError = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchAffiliateOnboarding.pending, (s) => {
      s.portalLoading = true;
      s.portalError = null;
    })
      .addCase(fetchAffiliateOnboarding.fulfilled, (s, a) => {
        s.portalLoading = false;
        s.portal = a.payload;
      })
      .addCase(fetchAffiliateOnboarding.rejected, (s, a) => {
        s.portalLoading = false;
        s.portalError = a.payload || "errors.server";
      });
    for (const t of [signAffiliateAgreement, submitAffiliateW9]) {
      b.addCase(t.pending, (s) => {
        s.submitting = true;
        s.submitError = null;
      })
        .addCase(t.fulfilled, (s, a) => {
          s.submitting = false;
          s.portal = a.payload;
        })
        .addCase(t.rejected, (s, a) => {
          s.submitting = false;
          s.submitError = a.payload || "errors.server";
        });
    }
    b.addCase(fetchAdminAffiliateOnboarding.pending, (s) => {
      s.adminLoading = true;
      s.adminError = null;
    })
      .addCase(fetchAdminAffiliateOnboarding.fulfilled, (s, a) => {
        s.adminLoading = false;
        s.admin = a.payload;
        s.adminFor = a.meta.arg;
      })
      .addCase(fetchAdminAffiliateOnboarding.rejected, (s, a) => {
        s.adminLoading = false;
        s.adminError = a.payload || "errors.server";
      });
    for (const t of [setAffiliateSubscriptionPrice, voidAffiliateAgreement, reviewAffiliateW9]) {
      b.addCase(t.pending, (s) => {
        s.adminSaving = true;
        s.adminError = null;
      })
        .addCase(t.fulfilled, (s) => {
          s.adminSaving = false;
        })
        .addCase(t.rejected, (s, a) => {
          s.adminSaving = false;
          s.adminError = a.payload || "errors.server";
        });
    }
    for (const t of [startCardSetup, activateCard, setBillingCancel]) {
      b.addCase(t.pending, (s) => {
        s.cardBusy = true;
        s.cardError = null;
      }).addCase(t.rejected, (s, a) => {
        s.cardBusy = false;
        s.cardError = a.payload || "errors.server";
      });
    }
    // Setup only hands a secret to the card form; it stays busy until activation.
    b.addCase(startCardSetup.fulfilled, () => undefined);
    for (const t of [activateCard, setBillingCancel]) {
      b.addCase(t.fulfilled, (s, a) => {
        s.cardBusy = false;
        s.status = a.payload.billing;
        // Paid / replaced: the pause lifts once billing is back in good standing.
        if (a.payload.billing.in_good_standing) s.locked = false;
        if (s.portal) {
          s.portal.billing = a.payload.billing;
          const live = ["trialing", "active"].includes(a.payload.billing.status) || !a.payload.billing.configured;
          // A card saved while pending counts for setup; the free period starts on approval.
          s.portal.state.billing_ready = live || a.payload.billing.awaiting_approval;
          s.portal.state.payout_ready =
            live && s.portal.state.agreement_signed && ["submitted", "accepted"].includes(s.portal.state.w9_status);
        }
      });
    }
    b.addCase(fetchAdminAffiliateBilling.fulfilled, (s, a) => {
      s.adminBilling = a.payload.billing;
      s.adminBillingFor = a.meta.arg;
    });
    b.addCase(fetchAgreementTemplate.fulfilled, (s, a) => {
      s.template = a.payload;
    })
      .addCase(publishAgreementTemplate.pending, (s) => {
        s.templateSaving = true;
        s.templateError = null;
      })
      .addCase(publishAgreementTemplate.fulfilled, (s, a) => {
        s.templateSaving = false;
        s.template = { ...a.payload, signed_count: 0 };
      })
      .addCase(publishAgreementTemplate.rejected, (s, a) => {
        s.templateSaving = false;
        s.templateError = a.payload || "errors.server";
      });
    b.addCase(fetchOutdatedAgreements.fulfilled, (s, a) => {
      s.outdated = a.payload;
    })
      .addCase(sendResignNotice.pending, (s) => {
        s.resignSending = true;
      })
      .addCase(sendResignNotice.fulfilled, (s, a) => {
        s.resignSending = false;
        s.resignSent = a.payload.sent;
      })
      .addCase(sendResignNotice.rejected, (s) => {
        s.resignSending = false;
      });
    b.addCase(fetchAffiliateBillingStatus.fulfilled, (s, a) => {
      s.status = a.payload.billing;
      s.locked = a.payload.locked;
    });
    // Any affiliate call refused for billing (402) switches the portal to the billing page.
    b.addMatcher(isRejected, (s, a) => {
      if (a.payload === "errors.billingRequired" && a.type.startsWith("affiliate")) s.locked = true;
    });
  },
});

export const { clearOnboardingErrors, setCardError } = slice.actions;
export default slice.reducer;
