import { createSlice, isAnyOf } from "@reduxjs/toolkit";
import type {
  CityDetail,
  CityKpis,
  CityPartnerClient,
  CityPartnerDetail,
  CityPartnerFee,
  CityPartnerListItem,
  CityPartnerOnboarding,
  CityPartnerOverview,
  CityPipelineCity,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** City Partners: staff screens (admin) and the partner portal (city) share the pipeline thunks. */
export type CityScope = "admin" | "city";
const scopeActor = (a: CityScope | { scope: CityScope }) => ((typeof a === "string" ? a : a.scope) === "admin" ? "admin" : "city");
const base = (scope: CityScope) => (scope === "admin" ? "/admin/city-pipeline" : "/city/cities");
type CityList = { cities: CityPipelineCity[]; kpis: CityKpis };

export type CityListQuery = { scope: CityScope; q?: string; stage?: string; priority?: string; follow_up?: string; opened?: string; partner_id?: string; sort?: string; limit?: number; offset?: number };
export const fetchCityList = createApiThunk<CityList & { total: number }, CityScope | CityListQuery>("cityPartner/list", scopeActor, async (arg) => {
  const { scope, ...params } = typeof arg === "string" ? { scope: arg } : arg;
  return (await api.get(base(scope), { params })).data;
});
export const fetchCityDetail = createApiThunk<CityDetail, { scope: CityScope; id: number }>("cityPartner/detail", scopeActor, async ({ scope, id }) => (await api.get(`${base(scope)}/${id}`)).data);
export const updateCity = createApiThunk<CityDetail, { scope: CityScope; id: number; body: Record<string, unknown> }>("cityPartner/update", scopeActor, async ({ scope, id, body }) => (await api.patch(`${base(scope)}/${id}`, body)).data);
export const addCityActivity = createApiThunk<CityDetail, { scope: CityScope; id: number; body: Record<string, unknown> }>("cityPartner/activity", scopeActor, async ({ scope, id, body }) => (await api.post(`${base(scope)}/${id}/activities`, body)).data);
export const deleteCityActivity = createApiThunk<CityDetail, { scope: CityScope; id: number; activityId: number }>("cityPartner/activityDelete", scopeActor, async ({ scope, id, activityId }) => (await api.delete(`${base(scope)}/${id}/activities/${activityId}`)).data);
export const addPipelineCity = createApiThunk<CityList, { city_id: number }>("cityPartner/addCity", "admin", async (body) => (await api.post("/admin/city-pipeline", body)).data);
export const saveCityIntel = createApiThunk<CityDetail, { id: number; body: Record<string, unknown> }>("cityPartner/intel", "admin", async ({ id, body }) => (await api.patch(`/admin/city-pipeline/${id}/intel`, body)).data);
export const verifyCityIntel = createApiThunk<CityDetail, number>("cityPartner/verify", "admin", async (id) => (await api.post(`/admin/city-pipeline/${id}/intel/verify`)).data);
export const addCityContact = createApiThunk<CityDetail, { id: number; body: Record<string, unknown> }>("cityPartner/contact", "admin", async ({ id, body }) => (await api.post(`/admin/city-pipeline/${id}/contacts`, body)).data);
export const deleteCityContact = createApiThunk<CityDetail, { id: number; contactId: number }>("cityPartner/contactDelete", "admin", async ({ id, contactId }) => (await api.delete(`/admin/city-pipeline/${id}/contacts/${contactId}`)).data);

export type PartnerQuery = { q?: string; status?: string; agreement?: string; w9?: string; city_id?: string; limit: number; offset: number };
export const fetchCityPartners = createApiThunk<{ items: CityPartnerListItem[]; total: number }, PartnerQuery>("cityPartner/partners", "admin", async (params) => (await api.get("/admin/city-partners", { params })).data);
export const deleteCityPartner = createApiThunk<{ ok: true }, { id: number; confirm_name: string }>("cityPartner/delete", "admin", async ({ id, confirm_name }) => (await api.delete(`/admin/city-partners/${id}`, { data: { confirm_name } })).data);
export const createCityPartner = createApiThunk<{ id: number }, Record<string, unknown>>("cityPartner/create", "admin", async (body) => (await api.post("/admin/city-partners", body)).data);
export const fetchCityPartner = createApiThunk<CityPartnerDetail, number>("cityPartner/partner", "admin", async (id) => (await api.get(`/admin/city-partners/${id}`)).data);
export const updateCityPartner = createApiThunk<{ ok: true }, { id: number; body: Record<string, unknown> }>("cityPartner/partnerUpdate", "admin", async ({ id, body }) => (await api.patch(`/admin/city-partners/${id}`, body)).data);
export const resendCityPartnerInvite = createApiThunk<{ ok: true }, number>("cityPartner/invite", "admin", async (id) => (await api.post(`/admin/city-partners/${id}/invite`)).data);
/** Super admins: open the partner portal read-only in this browser (30 minutes, logged on the partner). */
export const viewAsCityPartner = createApiThunk<{ ok: true; url: string; expires_at: string }, number>("cityPartner/viewAs", "admin", async (id) => (await api.post(`/admin/city-partners/${id}/view-as`)).data);
export type EmailPreview = { subject: string; html: string };
/** Render the invite email without sending it: draft fields (invite modal) or a saved partner (resend). */
export const previewCityInvite = createApiThunk<EmailPreview, number | Record<string, unknown>>("cityPartner/invitePreview", "admin", async (arg) =>
  (typeof arg === "number" ? await api.get(`/admin/city-partners/${arg}/invite-preview`) : await api.post("/admin/city-partners/invite-preview", arg)).data,
);
export const countersignCityAgreement = createApiThunk<{ ok: true }, { id: number; agreementId: number; name: string }>("cityPartner/countersign", "admin", async ({ id, agreementId, name }) => (await api.post(`/admin/city-partners/${id}/agreements/${agreementId}/countersign`, { name })).data);
export const reviewCityW9 = createApiThunk<{ ok: true }, { id: number; w9Id: number; status: "accepted" | "rejected"; note?: string }>("cityPartner/w9Review", "admin", async ({ id, w9Id, ...body }) => (await api.post(`/admin/city-partners/${id}/w9s/${w9Id}/review`, body)).data);
export const updateCityFee = createApiThunk<{ item: CityPartnerFee }, { id: number; status: string; note?: string }>("cityPartner/fee", "admin", async ({ id, ...body }) => (await api.patch(`/admin/city-partner-fees/${id}`, body)).data);
export const setProjectFundsReceived = createApiThunk<{ funds_received_on: string | null; fees: CityPartnerFee[] }, { publicId: string; date: string | null }>("cityPartner/funds", "admin", async ({ publicId, date }) => (await api.patch(`/admin/projects/${publicId}/funds-received`, { date })).data);

export const fetchCityOverview = createApiThunk<CityPartnerOverview, void>("cityPartner/overview", "city", async () => (await api.get("/city/overview")).data);
export const fetchCityOnboarding = createApiThunk<CityPartnerOnboarding, void>("cityPartner/onboarding", "city", async () => (await api.get("/city/onboarding")).data);
export const signCityAgreement = createApiThunk<CityPartnerOnboarding, { signer_name: string; signer_title: string; consent: true; text_sha256: string }>("cityPartner/sign", "city", async (body) => (await api.post("/city/onboarding/agreement", body)).data);
export const submitCityW9 = createApiThunk<CityPartnerOnboarding, Record<string, unknown>>("cityPartner/w9", "city", async (body) => (await api.post("/city/onboarding/w9", body)).data);
export const fetchCityClients = createApiThunk<{ clients: CityPartnerClient[] }, void>("cityPartner/clients", "city", async () => (await api.get("/city/clients")).data);
export type FeeQuery = { status?: string; partner_id?: string; city_id?: string; due_from?: string; due_to?: string; limit: number; offset: number };
export type FeeTotals = { status: string; count: number; amount_cents: number }[];
export const fetchAllCityFees = createApiThunk<{ items: CityPartnerFee[]; total: number; totals: FeeTotals }, FeeQuery>("cityPartner/allFees", "admin", async (params) => (await api.get("/admin/city-partner-fees", { params })).data);
export const updateCityProfile = createApiThunk<{ partner: unknown }, { first_name: string; last_name: string; phone: string; preferred_language: string }>("cityPartner/profile", "city", async (body) => (await api.patch("/city/profile", body)).data);
export const fetchCityFees = createApiThunk<{ items: CityPartnerFee[] }, void>("cityPartner/fees", "city", async () => (await api.get("/city/fees")).data);

type State = {
  list: (CityList & { total: number }) | null;
  detail: CityDetail | null;
  partners: CityPartnerListItem[];
  partnersTotal: number;
  partner: CityPartnerDetail | null;
  overview: CityPartnerOverview | null;
  onboarding: CityPartnerOnboarding | null;
  clients: CityPartnerClient[];
  fees: CityPartnerFee[];
  allFees: CityPartnerFee[];
  feesTotal: number;
  feeTotals: FeeTotals;
  loading: boolean;
  saving: boolean;
  error: string | null;
  invitePreview: EmailPreview | null;
  previewing: boolean;
};
const initialState: State = { list: null, detail: null, partners: [], partnersTotal: 0, partner: null, overview: null, onboarding: null, clients: [], fees: [], allFees: [], feesTotal: 0, feeTotals: [], loading: false, saving: false, error: null, invitePreview: null, previewing: false };

const reads = [fetchAllCityFees, fetchCityList, fetchCityDetail, fetchCityPartners, fetchCityPartner, fetchCityOverview, fetchCityOnboarding, fetchCityClients, fetchCityFees] as const;
const writes = [updateCity, addCityActivity, deleteCityActivity, addPipelineCity, saveCityIntel, verifyCityIntel, addCityContact, deleteCityContact, createCityPartner, updateCityPartner, resendCityPartnerInvite, countersignCityAgreement, reviewCityW9, updateCityFee, setProjectFundsReceived, signCityAgreement, submitCityW9, updateCityProfile, deleteCityPartner] as const;

const slice = createSlice({
  name: "cityPartner",
  initialState,
  reducers: {
    clearCityError(s) {
      s.error = null;
    },
    clearInvitePreview(s) {
      s.invitePreview = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchCityList.fulfilled, (s, a) => {
      s.list = a.payload;
    })
      .addCase(addPipelineCity.fulfilled, (s, a) => {
        s.list = { ...a.payload, total: a.payload.cities.length };
      })
      .addCase(fetchCityPartners.fulfilled, (s, a) => {
        s.partners = a.payload.items;
        s.partnersTotal = a.payload.total;
      })
      .addCase(fetchCityPartner.fulfilled, (s, a) => {
        s.partner = a.payload;
      })
      .addCase(fetchCityOverview.fulfilled, (s, a) => {
        s.overview = a.payload;
      })
      .addCase(fetchCityClients.fulfilled, (s, a) => {
        s.clients = a.payload.clients;
      })
      .addCase(fetchCityFees.fulfilled, (s, a) => {
        s.fees = a.payload.items;
      })
      .addCase(fetchAllCityFees.fulfilled, (s, a) => {
        s.allFees = a.payload.items;
        s.feesTotal = a.payload.total;
        s.feeTotals = a.payload.totals;
      })
      .addCase(previewCityInvite.pending, (s) => {
        s.previewing = true;
        s.error = null;
      })
      .addCase(previewCityInvite.fulfilled, (s, a) => {
        s.previewing = false;
        s.invitePreview = { subject: a.payload.subject, html: a.payload.html };
      })
      .addCase(previewCityInvite.rejected, (s, a) => {
        s.previewing = false;
        s.error = (a.payload as string) || "errors.server";
      })
      .addCase(updateCityFee.fulfilled, (s, a) => {
        s.allFees = s.allFees.map((f) => (f.id === a.payload.item.id ? a.payload.item : f));
        if (s.partner) s.partner.fees = s.partner.fees.map((f) => (f.id === a.payload.item.id ? a.payload.item : f));
      })
      .addMatcher(isAnyOf(fetchCityDetail.fulfilled, updateCity.fulfilled, addCityActivity.fulfilled, deleteCityActivity.fulfilled, saveCityIntel.fulfilled, verifyCityIntel.fulfilled, addCityContact.fulfilled, deleteCityContact.fulfilled), (s, a) => {
        s.detail = a.payload;
      })
      .addMatcher(isAnyOf(fetchCityOnboarding.fulfilled, signCityAgreement.fulfilled, submitCityW9.fulfilled), (s, a) => {
        s.onboarding = a.payload;
      })
      .addMatcher(isAnyOf(...reads.map((t) => t.pending)), (s) => {
        s.loading = true;
        s.error = null;
      })
      .addMatcher(isAnyOf(...reads.map((t) => t.fulfilled)), (s) => {
        s.loading = false;
      })
      .addMatcher(isAnyOf(...reads.map((t) => t.rejected)), (s, a) => {
        s.loading = false;
        s.error = (a.payload as string) || "errors.server";
      })
      .addMatcher(isAnyOf(...writes.map((t) => t.pending)), (s) => {
        s.saving = true;
        s.error = null;
      })
      .addMatcher(isAnyOf(...writes.map((t) => t.fulfilled)), (s) => {
        s.saving = false;
      })
      .addMatcher(isAnyOf(...writes.map((t) => t.rejected)), (s, a) => {
        s.saving = false;
        s.error = (a.payload as string) || "errors.server";
      });
  },
});

export const { clearCityError, clearInvitePreview } = slice.actions;
export default slice.reducer;
