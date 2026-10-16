import { createSlice } from "@reduxjs/toolkit";
import type { AdminBillingOverview, AdminMembership, BillingCardLinkView, BillingRole, PlatformBilling } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Admin → Billing: overview, one membership (drawer), staff actions, and the member's card link page. */

type Ref = { role: BillingRole; id: number };
const base = ({ role, id }: Ref) => `/admin/billing/${role}/${id}`;
type ActionResult = { billing: PlatformBilling; locked: boolean };

export const fetchBillingOverview = createApiThunk<AdminBillingOverview, void>(
  "billingAdmin/overview",
  "admin",
  async () => (await api.get("/admin/billing/overview")).data,
);

export const fetchMembership = createApiThunk<AdminMembership, Ref>(
  "billingAdmin/member",
  "admin",
  async (ref) => (await api.get(base(ref))).data,
);

export const cancelMembership = createApiThunk<ActionResult, Ref & { when: "now" | "period_end"; reason: string }>(
  "billingAdmin/cancel",
  "admin",
  async ({ when, reason, ...ref }) => (await api.post(`${base(ref)}/cancel`, { when, reason })).data,
);

export const resumeMembership = createApiThunk<ActionResult, Ref>(
  "billingAdmin/resume",
  "admin",
  async (ref) => (await api.post(`${base(ref)}/resume`, {})).data,
);

export const extendMembership = createApiThunk<ActionResult, Ref & { days: number; reason: string }>(
  "billingAdmin/extend",
  "admin",
  async ({ days, reason, ...ref }) => (await api.post(`${base(ref)}/extend`, { days, reason })).data,
);

export const refundInvoice = createApiThunk<{ refund: { id: string; amount_cents: number } }, Ref & { invoice_id: string; amount_cents: number | null; reason: string }>(
  "billingAdmin/refund",
  "admin",
  async ({ invoice_id, amount_cents, reason, ...ref }) => (await api.post(`${base(ref)}/refund`, { invoice_id, amount_cents, reason })).data,
);

export const setMembershipPrice = createApiThunk<ActionResult, Ref & { price_cents: number | null; reason?: string }>(
  "billingAdmin/price",
  "admin",
  async ({ price_cents, reason, ...ref }) => (await api.patch(`${base(ref)}/price`, { price_cents, reason })).data,
);

export const sendCardLink = createApiThunk<{ sent: boolean }, Ref & { price_cents: number | null; free_days: number | null; note: string }>(
  "billingAdmin/cardLink",
  "admin",
  async ({ price_cents, free_days, note, ...ref }) => (await api.post(`${base(ref)}/card-link`, { price_cents, free_days, note })).data,
);

// ── Public: member's secure card link ──
const link = (token: string) => `/public/billing-link/${token}`;
export const fetchCardLink = createApiThunk<BillingCardLinkView, string>("billingAdmin/link", null, async (token) => (await api.get(link(token))).data);
export const startCardLinkSetup = createApiThunk<{ client_secret: string }, string>(
  "billingAdmin/linkSetup",
  null,
  async (token) => (await api.post(`${link(token)}/setup`)).data,
);
export const activateCardLink = createApiThunk<{ billing: PlatformBilling }, { token: string; setup_intent_id: string }>(
  "billingAdmin/linkActivate",
  null,
  async ({ token, setup_intent_id }) => (await api.post(`${link(token)}/activate`, { setup_intent_id })).data,
);

type State = {
  overview: AdminBillingOverview | null;
  overviewLoading: boolean;
  overviewError: string | null;
  member: AdminMembership | null;
  memberLoading: boolean;
  acting: boolean;
  actionError: string | null;
  link: BillingCardLinkView | null;
  linkError: string | null;
  linkBusy: boolean;
  linkCardError: string | null;
  linkDone: PlatformBilling | null;
};

const initialState: State = {
  overview: null,
  overviewLoading: false,
  overviewError: null,
  member: null,
  memberLoading: false,
  acting: false,
  actionError: null,
  link: null,
  linkError: null,
  linkBusy: false,
  linkCardError: null,
  linkDone: null,
};

const slice = createSlice({
  name: "billingAdmin",
  initialState,
  reducers: {
    clearBillingActionError(s) {
      s.actionError = null;
    },
    closeMembership(s) {
      s.member = null;
      s.actionError = null;
    },
    setCardLinkError(s, a: { payload: string | null }) {
      s.linkBusy = false;
      s.linkCardError = a.payload;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchBillingOverview.pending, (s) => {
      s.overviewLoading = true;
      s.overviewError = null;
    })
      .addCase(fetchBillingOverview.fulfilled, (s, a) => {
        s.overviewLoading = false;
        s.overview = a.payload;
      })
      .addCase(fetchBillingOverview.rejected, (s, a) => {
        s.overviewLoading = false;
        s.overviewError = a.payload || "errors.server";
      })
      .addCase(fetchMembership.pending, (s, a) => {
        s.memberLoading = true;
        if (s.member && (s.member.member.role !== a.meta.arg.role || s.member.member.id !== a.meta.arg.id)) s.member = null;
      })
      .addCase(fetchMembership.fulfilled, (s, a) => {
        s.memberLoading = false;
        s.member = a.payload;
      })
      .addCase(fetchMembership.rejected, (s, a) => {
        s.memberLoading = false;
        s.actionError = a.payload || "errors.server";
      });
    for (const t of [cancelMembership, resumeMembership, extendMembership, refundInvoice, setMembershipPrice, sendCardLink]) {
      b.addCase(t.pending, (s) => {
        s.acting = true;
        s.actionError = null;
      })
        .addCase(t.fulfilled, (s) => {
          s.acting = false;
        })
        .addCase(t.rejected, (s, a) => {
          s.acting = false;
          s.actionError = a.payload || "errors.server";
        });
    }
    b.addCase(fetchCardLink.fulfilled, (s, a) => {
      s.link = a.payload;
      s.linkError = null;
    })
      .addCase(fetchCardLink.rejected, (s, a) => {
        s.linkError = a.payload || "errors.billingLinkInvalid";
      })
      .addCase(startCardLinkSetup.pending, (s) => {
        s.linkBusy = true;
        s.linkCardError = null;
      })
      .addCase(startCardLinkSetup.rejected, (s, a) => {
        s.linkBusy = false;
        s.linkCardError = a.payload || "errors.server";
      })
      .addCase(activateCardLink.fulfilled, (s, a) => {
        s.linkBusy = false;
        s.linkDone = a.payload.billing;
      })
      .addCase(activateCardLink.rejected, (s, a) => {
        s.linkBusy = false;
        s.linkCardError = a.payload || "errors.server";
      });
  },
});

export const { clearBillingActionError, closeMembership, setCardLinkError } = slice.actions;
export default slice.reducer;
