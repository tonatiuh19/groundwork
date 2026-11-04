import { createSlice } from "@reduxjs/toolkit";
import type {
  ConstructionAgreementTemplate,
  ConstructionAgreementTemplatesResponse,
  ProjectConstructionAgreementResponse,
  PublicAgreementSignBody,
  PublicAgreementSignView,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** ADU construction agreement: project panel (staff), template versions (Settings) and the public signing page. */

type View = ProjectConstructionAgreementResponse;

export const fetchProjectAgreement = createApiThunk<View, string>("agreement/fetch", "admin", async (pub) => (await api.get(`/admin/projects/${pub}/construction-agreement`)).data);
/** Every project action carries the project public id (`pub`) so the result lands on the right panel. */
type P = { pub: string };
export const createProjectAgreement = createApiThunk<View, P>("agreement/create", "admin", async ({ pub }) => (await api.post(`/admin/projects/${pub}/construction-agreement`, {})).data);
export const saveAgreementFields = createApiThunk<View, P & { id: number; fields: Record<string, string>; use_latest_template?: boolean }>(
  "agreement/save",
  "admin",
  async ({ id, pub: _pub, ...body }) => (await api.put(`/admin/construction-agreements/${id}`, body)).data,
);
export const prefillAgreement = createApiThunk<View, P & { id: number }>("agreement/prefill", "admin", async ({ id }) => (await api.post(`/admin/construction-agreements/${id}/prefill`)).data);
export const sendAgreement = createApiThunk<View, P & { id: number }>("agreement/send", "admin", async ({ id }) => (await api.post(`/admin/construction-agreements/${id}/send`)).data);
export const resendAgreement = createApiThunk<View, P & { id: number; party: "client" | "contractor" }>(
  "agreement/resend",
  "admin",
  async ({ id, party }) => (await api.post(`/admin/construction-agreements/${id}/resend`, { party })).data,
);
export const countersignAgreement = createApiThunk<View, P & { id: number; signed_name: string; title: string; signature_image: string }>(
  "agreement/countersign",
  "admin",
  async ({ id, pub: _pub, ...body }) => (await api.post(`/admin/construction-agreements/${id}/sign`, body)).data,
);
export const voidAgreement = createApiThunk<View, P & { id: number; reason: string }>(
  "agreement/void",
  "admin",
  async ({ id, reason }) => (await api.post(`/admin/construction-agreements/${id}/void`, { reason })).data,
);

export const fetchAgreementTemplates = createApiThunk<ConstructionAgreementTemplatesResponse, void>(
  "agreement/templates",
  "admin",
  async () => (await api.get("/admin/construction-agreement/template")).data,
);
export const createAgreementTemplate = createApiThunk<{ ok: true; template: ConstructionAgreementTemplate }, { body_en: string; notes?: string }>(
  "agreement/templateCreate",
  "admin",
  async (body) => (await api.post("/admin/construction-agreement/template", body)).data,
);
export const saveAgreementTemplate = createApiThunk<{ ok: true; template: ConstructionAgreementTemplate }, { version: number; body_en: string; notes?: string }>(
  "agreement/templateSave",
  "admin",
  async ({ version, ...body }) => (await api.put(`/admin/construction-agreement/template/${version}`, body)).data,
);
export const approveAgreementTemplate = createApiThunk<{ ok: true; template: ConstructionAgreementTemplate }, { version: number; confirm_phrase: string }>(
  "agreement/templateApprove",
  "admin",
  async ({ version, confirm_phrase }) => (await api.post(`/admin/construction-agreement/template/${version}/approve`, { confirm_phrase })).data,
);

export const fetchSignView = createApiThunk<PublicAgreementSignView, string>("agreement/signView", null, async (token) => (await api.get(`/public/agreement-sign/${token}`)).data);
export const submitSignature = createApiThunk<PublicAgreementSignView, { token: string; body: PublicAgreementSignBody }>(
  "agreement/sign",
  null,
  async ({ token, body }) => (await api.post(`/public/agreement-sign/${token}`, body)).data,
);

type State = {
  byProject: Record<string, View>;
  loading: boolean;
  busy: string | null;
  error: string | null;
  templates: ConstructionAgreementTemplatesResponse | null;
  templateBusy: boolean;
  templateError: string | null;
  sign: PublicAgreementSignView | null;
  signLoading: boolean;
  signBusy: boolean;
  signError: string | null;
};

const initialState: State = {
  byProject: {},
  loading: false,
  busy: null,
  error: null,
  templates: null,
  templateBusy: false,
  templateError: null,
  sign: null,
  signLoading: false,
  signBusy: false,
  signError: null,
};

const projectThunks = [createProjectAgreement, saveAgreementFields, prefillAgreement, sendAgreement, resendAgreement, countersignAgreement, voidAgreement] as const;
const templateThunks = [createAgreementTemplate, saveAgreementTemplate, approveAgreementTemplate] as const;

const slice = createSlice({
  name: "constructionAgreement",
  initialState,
  reducers: {
    clearAgreementError: (s) => {
      s.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchProjectAgreement.pending, (s) => {
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchProjectAgreement.fulfilled, (s, a) => {
        s.loading = false;
        s.byProject[a.meta.arg] = a.payload;
      })
      .addCase(fetchProjectAgreement.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(fetchAgreementTemplates.fulfilled, (s, a) => {
        s.templates = a.payload;
      })
      .addCase(fetchAgreementTemplates.rejected, (s, a) => {
        s.templateError = a.payload || "errors.server";
      })
      .addCase(fetchSignView.pending, (s) => {
        s.signLoading = true;
        s.signError = null;
      })
      .addCase(fetchSignView.fulfilled, (s, a) => {
        s.signLoading = false;
        s.sign = a.payload;
      })
      .addCase(fetchSignView.rejected, (s, a) => {
        s.signLoading = false;
        s.signError = a.payload || "errors.server";
      })
      .addCase(submitSignature.pending, (s) => {
        s.signBusy = true;
        s.signError = null;
      })
      .addCase(submitSignature.fulfilled, (s, a) => {
        s.signBusy = false;
        s.sign = a.payload;
      })
      .addCase(submitSignature.rejected, (s, a) => {
        s.signBusy = false;
        s.signError = a.payload || "errors.server";
      });
    for (const th of projectThunks) {
      b.addCase(th.pending, (s, a) => {
        s.busy = a.type.split("/")[1];
        s.error = null;
      })
        .addCase(th.fulfilled, (s, a) => {
          s.busy = null;
          s.byProject[a.meta.arg.pub] = a.payload;
        })
        .addCase(th.rejected, (s, a) => {
          s.busy = null;
          s.error = a.payload || "errors.server";
        });
    }
    for (const th of templateThunks) {
      b.addCase(th.pending, (s) => {
        s.templateBusy = true;
        s.templateError = null;
      })
        .addCase(th.fulfilled, (s, a) => {
          s.templateBusy = false;
          if (!s.templates) return;
          const t = a.payload.template;
          const i = s.templates.versions.findIndex((v) => v.version === t.version);
          if (i >= 0) s.templates.versions[i] = { ...s.templates.versions[i], ...t };
          else s.templates.versions.unshift({ ...t, agreements: 0 });
        })
        .addCase(th.rejected, (s, a) => {
          s.templateBusy = false;
          s.templateError = a.payload || "errors.server";
        });
    }
  },
});

export const { clearAgreementError } = slice.actions;
export default slice.reducer;
