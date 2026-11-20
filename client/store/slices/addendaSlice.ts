import { createSlice } from "@reduxjs/toolkit";
import type {
  AddendumBody,
  AddendumLogRow,
  AddendumProjectRow,
  AffiliateAddendum,
  AffiliateProduction,
  EventAddendumRow,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Special agreements (affiliate addenda): staff drafting / sending / countersigning + the affiliate's side. */

type One = { addendum: AffiliateAddendum };

export const fetchAffiliateAddenda = createApiThunk<{ addenda: AffiliateAddendum[] }, number>(
  "addenda/forAffiliate",
  "admin",
  async (affiliateId) => (await api.get(`/admin/affiliates/${affiliateId}/addenda`)).data,
);
export const createAddendum = createApiThunk<One, { affiliateId: number; body: AddendumBody }>(
  "addenda/create",
  "admin",
  async ({ affiliateId, body }) => (await api.post(`/admin/affiliates/${affiliateId}/addenda`, body)).data,
);
export const saveAddendum = createApiThunk<One, { id: number; body: AddendumBody }>(
  "addenda/save",
  "admin",
  async ({ id, body }) => (await api.put(`/admin/addenda/${id}`, body)).data,
);
export const previewAddendum = createApiThunk<{ en: string; es: string; missing: string[] }, number>(
  "addenda/preview",
  "admin",
  async (id) => (await api.get(`/admin/addenda/${id}/preview`)).data,
);
export const sendAddendum = createApiThunk<One, number>("addenda/send", "admin", async (id) => (await api.post(`/admin/addenda/${id}/send`)).data);
export const countersignAddendum = createApiThunk<One, { id: number; name: string }>(
  "addenda/countersign",
  "admin",
  async ({ id, name }) => (await api.post(`/admin/addenda/${id}/countersign`, { name })).data,
);
export const voidAddendum = createApiThunk<One, { id: number; reason: string }>(
  "addenda/void",
  "admin",
  async ({ id, reason }) => (await api.post(`/admin/addenda/${id}/void`, { reason })).data,
);
export const fetchAddendumProjects = createApiThunk<{ projects: AddendumProjectRow[]; log: AddendumLogRow[] }, number>(
  "addenda/projects",
  "admin",
  async (id) => (await api.get(`/admin/addenda/${id}/projects`)).data,
);
export const tagAddendumProject = createApiThunk<{ ok: true }, { id: number; projectId: number; mode: "include" | "exclude" | "clear"; reason?: string }>(
  "addenda/tag",
  "admin",
  async ({ id, projectId, mode, reason }) => (await api.post(`/admin/addenda/${id}/projects/${projectId}`, { mode, reason })).data,
);
export type AddendumOptions = {
  events: Array<{ id: number; title: string; title_es: string; starts_at: string | null; city: string | null }>;
  affiliates: Array<{ id: number; name: string; company: string | null; status: string }>;
};
export const fetchAddendumOptions = createApiThunk<AddendumOptions, void>(
  "addenda/options",
  "admin",
  async () => (await api.get("/admin/addenda/options")).data,
);
export const fetchEventAddenda = createApiThunk<{ addenda: EventAddendumRow[] }, number>(
  "addenda/forEvent",
  "admin",
  async (eventId) => (await api.get(`/admin/events/${eventId}/addenda`)).data,
);

export const fetchMyAddenda = createApiThunk<{ addenda: AffiliateAddendum[] }, void>(
  "addenda/mine",
  "affiliate",
  async () => (await api.get("/affiliate/addenda")).data,
);
export const signMyAddendum = createApiThunk<
  One,
  { id: number; lang: "en" | "es"; text_sha256: string; signed_name: string; signature_image: string; consent: true }
>("addenda/sign", "affiliate", async ({ id, ...body }) => (await api.post(`/affiliate/addenda/${id}/sign`, body)).data);
export const fetchMyProduction = createApiThunk<{ agreements: AffiliateProduction[] }, void>(
  "addenda/production",
  "affiliate",
  async () => (await api.get("/affiliate/production")).data,
);

type State = {
  byAffiliate: Record<number, AffiliateAddendum[]>;
  projects: Record<number, { projects: AddendumProjectRow[]; log: AddendumLogRow[] }>;
  byEvent: Record<number, EventAddendumRow[]>;
  mine: AffiliateAddendum[] | null;
  options: AddendumOptions | null;
  production: AffiliateProduction[] | null;
  busy: boolean;
  error: string | null;
};

const initialState: State = { byAffiliate: {}, projects: {}, byEvent: {}, mine: null, options: null, production: null, busy: false, error: null };

const upsert = (s: State, a: AffiliateAddendum) => {
  const list = s.byAffiliate[a.affiliate_id] || [];
  s.byAffiliate[a.affiliate_id] = list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [a, ...list];
};

const slice = createSlice({
  name: "addenda",
  initialState,
  reducers: {
    clearAddendaError(s) {
      s.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchAffiliateAddenda.fulfilled, (s, a) => {
      s.byAffiliate[a.meta.arg] = a.payload.addenda;
    })
      .addCase(fetchAddendumProjects.fulfilled, (s, a) => {
        s.projects[a.meta.arg] = a.payload;
      })
      .addCase(fetchAddendumOptions.fulfilled, (s, a) => {
        s.options = a.payload;
      })
      .addCase(fetchEventAddenda.fulfilled, (s, a) => {
        s.byEvent[a.meta.arg] = a.payload.addenda;
      })
      .addCase(fetchMyAddenda.fulfilled, (s, a) => {
        s.mine = a.payload.addenda;
      })
      .addCase(fetchMyAddenda.rejected, (s) => {
        s.mine = s.mine ?? [];
      })
      .addCase(fetchMyProduction.fulfilled, (s, a) => {
        s.production = a.payload.agreements;
      })
      .addCase(fetchMyProduction.rejected, (s, a) => {
        s.production = s.production ?? [];
        s.error = a.payload || "errors.server";
      });
    for (const t of [createAddendum, saveAddendum, sendAddendum, countersignAddendum, voidAddendum]) {
      b.addCase(t.pending, (s) => {
        s.busy = true;
        s.error = null;
      })
        .addCase(t.fulfilled, (s, a) => {
          s.busy = false;
          upsert(s, a.payload.addendum);
        })
        .addCase(t.rejected, (s, a) => {
          s.busy = false;
          s.error = a.payload || "errors.server";
        });
    }
    for (const t of [tagAddendumProject, previewAddendum]) {
      b.addCase(t.pending, (s) => {
        s.busy = true;
        s.error = null;
      })
        .addCase(t.fulfilled, (s) => {
          s.busy = false;
        })
        .addCase(t.rejected, (s, a) => {
          s.busy = false;
          s.error = a.payload || "errors.server";
        });
    }
    b.addCase(signMyAddendum.pending, (s) => {
      s.busy = true;
      s.error = null;
    })
      .addCase(signMyAddendum.fulfilled, (s, a) => {
        s.busy = false;
        s.mine = (s.mine || []).map((x) => (x.id === a.payload.addendum.id ? a.payload.addendum : x));
      })
      .addCase(signMyAddendum.rejected, (s, a) => {
        s.busy = false;
        s.error = a.payload || "errors.server";
      });
  },
});

export const { clearAddendaError } = slice.actions;
export default slice.reducer;
