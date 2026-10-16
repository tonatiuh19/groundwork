import { createSlice, isRejected } from "@reduxjs/toolkit";
import type { ContractorBillingResponse, PlatformBilling } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/**
 * Contractor platform membership: the card saved during the application
 * (magic-link token), the portal lock + card management, and admin controls.
 */

const app = (token: string) => `/public/contractor-application/${token}/billing`;

export const fetchApplicationBilling = createApiThunk<{ billing: PlatformBilling }, string>(
  "contractorBilling/application",
  null,
  async (token) => (await api.get(app(token))).data,
);

export const startApplicationCardSetup = createApiThunk<{ client_secret: string }, string>(
  "contractorBilling/applicationSetup",
  null,
  async (token) => (await api.post(`${app(token)}/setup`)).data,
);

export const activateApplicationCard = createApiThunk<{ billing: PlatformBilling }, { token: string; setup_intent_id: string }>(
  "contractorBilling/applicationActivate",
  null,
  async ({ token, setup_intent_id }) => (await api.post(`${app(token)}/activate`, { setup_intent_id })).data,
);

export const fetchContractorBilling = createApiThunk<ContractorBillingResponse, void>(
  "contractorBilling/fetch",
  "contractor",
  async () => (await api.get("/contractor/billing")).data,
);

export const startContractorCardSetup = createApiThunk<{ client_secret: string }, void>(
  "contractorBilling/setup",
  "contractor",
  async () => (await api.post("/contractor/billing/setup")).data,
);

export const activateContractorCard = createApiThunk<ContractorBillingResponse, { setup_intent_id: string }>(
  "contractorBilling/activate",
  "contractor",
  async (body) => (await api.post("/contractor/billing/activate", body)).data,
);

export const setContractorBillingCancel = createApiThunk<ContractorBillingResponse, { resume: boolean }>(
  "contractorBilling/cancel",
  "contractor",
  async (body) => (await api.post("/contractor/billing/cancel", body)).data,
);

export const fetchAdminContractorBilling = createApiThunk<ContractorBillingResponse, number>(
  "contractorBilling/admin",
  "admin",
  async (id) => (await api.get(`/admin/contractors/${id}/billing`)).data,
);

export const setContractorPrice = createApiThunk<ContractorBillingResponse, { id: number; price_cents: number | null }>(
  "contractorBilling/adminPrice",
  "admin",
  async ({ id, price_cents }) => (await api.patch(`/admin/contractors/${id}/billing`, { price_cents })).data,
);

type State = {
  application: PlatformBilling | null;
  portal: PlatformBilling | null;
  /** Approved contractor without a membership in good standing → portal shows the billing page. */
  locked: boolean;
  admin: (ContractorBillingResponse & { id: number }) | null;
  busy: boolean;
  error: string | null;
  adminSaving: boolean;
  adminError: string | null;
};

const initialState: State = {
  application: null,
  portal: null,
  locked: false,
  admin: null,
  busy: false,
  error: null,
  adminSaving: false,
  adminError: null,
};

const slice = createSlice({
  name: "contractorBilling",
  initialState,
  reducers: {
    setContractorCardError(s, a: { payload: string | null }) {
      s.busy = false;
      s.error = a.payload;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchApplicationBilling.fulfilled, (s, a) => {
      s.application = a.payload.billing;
    })
      .addCase(activateApplicationCard.fulfilled, (s, a) => {
        s.busy = false;
        s.application = a.payload.billing;
      })
      .addCase(fetchContractorBilling.fulfilled, (s, a) => {
        s.portal = a.payload.billing;
        s.locked = a.payload.locked;
      });
    for (const t of [activateContractorCard, setContractorBillingCancel]) {
      b.addCase(t.fulfilled, (s, a) => {
        s.busy = false;
        s.portal = a.payload.billing;
        s.locked = a.payload.locked;
      });
    }
    for (const t of [startApplicationCardSetup, activateApplicationCard, startContractorCardSetup, activateContractorCard, setContractorBillingCancel]) {
      b.addCase(t.pending, (s) => {
        s.busy = true;
        s.error = null;
      }).addCase(t.rejected, (s, a) => {
        s.busy = false;
        s.error = a.payload || "errors.server";
      });
    }
    b.addCase(fetchAdminContractorBilling.fulfilled, (s, a) => {
      s.admin = { ...a.payload, id: a.meta.arg };
    })
      .addCase(setContractorPrice.pending, (s) => {
        s.adminSaving = true;
        s.adminError = null;
      })
      .addCase(setContractorPrice.fulfilled, (s, a) => {
        s.adminSaving = false;
        s.admin = { ...a.payload, id: a.meta.arg.id };
      })
      .addCase(setContractorPrice.rejected, (s, a) => {
        s.adminSaving = false;
        s.adminError = a.payload || "errors.server";
      });
    // Any contractor call refused for billing (402) switches the portal to the billing page.
    b.addMatcher(isRejected, (s, a) => {
      if (a.payload === "errors.billingRequired" && a.type.startsWith("contractor")) s.locked = true;
    });
  },
});

export const { setContractorCardError } = slice.actions;
export default slice.reducer;
