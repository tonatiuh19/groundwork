import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import { put as putBlob } from "@vercel/blob/client";
import {
  CONTRACTOR_DOC_SPECS,
  type ContractorApplicationData,
  type ContractorApplicationDocType,
  type ContractorApplicationDocument,
  type ContractorApplicationPublicView,
  type ContractorApplicationRequirements,
  type ContractorApplicationUploadTokenResponse,
  type ContractorPortalApplicationSummary,
  type SubmitContractorApplicationRequest,
} from "@shared/contractorApplication";
import { api, formatAxiosError } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type UploadSlot = { progress: number; error: string | null };

type State = {
  token: string | null;
  view: ContractorApplicationPublicView | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  lastSavedAt: number | null;
  uploads: Partial<Record<ContractorApplicationDocType, UploadSlot>>;
  docBusyId: number | null;
  docError: string | null;
  submitting: boolean;
  submitError: string | null;
  missingFields: string[];
  missingDocs: ContractorApplicationDocType[];
  submitted: boolean;
  resend: { sending: boolean; sent: boolean; error: string | null };
  portal: {
    summary: ContractorPortalApplicationSummary["application"];
    loaded: boolean;
    opening: boolean;
    error: string | null;
  };
};

const initialState: State = {
  token: null,
  view: null,
  loading: false,
  error: null,
  saving: false,
  saveError: null,
  lastSavedAt: null,
  uploads: {},
  docBusyId: null,
  docError: null,
  submitting: false,
  submitError: null,
  missingFields: [],
  missingDocs: [],
  submitted: false,
  resend: { sending: false, sent: false, error: null },
  portal: { summary: null, loaded: false, opening: false, error: null },
};

const base = (token: string) => `/public/contractor-application/${token}`;

export const fetchContractorApplication = createApiThunk<
  ContractorApplicationPublicView,
  { token: string; lang: "en" | "es" }
>(
  "contractorApplication/fetch",
  null,
  async ({ token, lang }) => (await api.get(base(token), { params: { lang } })).data,
);

export const saveContractorApplication = createApiThunk<
  { ok: true; requirements: ContractorApplicationRequirements; data: ContractorApplicationData; current_step: number },
  { token: string; data: ContractorApplicationData; current_step: number }
>("contractorApplication/save", null, async ({ token, data, current_step }) => {
  const r = await api.put(base(token), { data, current_step });
  return { ...r.data, data, current_step };
});

/**
 * Direct browser → private Blob upload (not bound by the 4.5MB function cap):
 * 1) API mints a pathname-scoped client token, 2) upload, 3) API verifies + registers.
 */
export const uploadContractorDocument = createAsyncThunk<
  ContractorApplicationDocument,
  { token: string; docType: ContractorApplicationDocType; file: File; expiresOn: string | null },
  { rejectValue: string }
>(
  "contractorApplication/upload",
  async ({ token, docType, file, expiresOn }, { dispatch, rejectWithValue }) => {
    try {
      const grant = (
        await api.post<ContractorApplicationUploadTokenResponse>(`${base(token)}/upload-token`, {
          doc_type: docType,
          content_type: file.type,
          size_bytes: file.size,
        })
      ).data;
      await putBlob(grant.pathname, file, {
        access: "private",
        token: grant.client_token,
        contentType: file.type,
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) =>
          dispatch(uploadProgress({ docType, progress: Math.round(percentage) })),
      });
      const reg = await api.post<{ ok: true; document: ContractorApplicationDocument }>(
        `${base(token)}/documents`,
        {
          doc_type: docType,
          pathname: grant.pathname,
          file_name: file.name,
          expires_on: expiresOn,
        },
      );
      return reg.data.document;
    } catch (error) {
      if (axios.isAxiosError(error)) return rejectWithValue(formatAxiosError(error, "errors.uploadFailed"));
      return rejectWithValue("errors.uploadFailed");
    }
  },
);

export const removeContractorDocument = createApiThunk<number, { token: string; id: number }>(
  "contractorApplication/removeDoc",
  null,
  async ({ token, id }) => {
    await api.delete(`${base(token)}/documents/${id}`);
    return id;
  },
);

export const updateContractorDocumentExpiry = createApiThunk<
  { id: number; expires_on: string },
  { token: string; id: number; expires_on: string }
>("contractorApplication/docExpiry", null, async ({ token, id, expires_on }) => {
  await api.patch(`${base(token)}/documents/${id}`, { expires_on });
  return { id, expires_on };
});

type SubmitFailure = {
  error: string;
  missing_fields?: string[];
  missing_docs?: ContractorApplicationDocType[];
};

export const submitContractorApplication = createAsyncThunk<
  { status: "submitted"; missing_docs: ContractorApplicationDocType[] },
  { token: string; body: SubmitContractorApplicationRequest & { lang: "en" | "es" } },
  { rejectValue: SubmitFailure }
>("contractorApplication/submit", async ({ token, body }, { rejectWithValue }) => {
  try {
    return (await api.post(`${base(token)}/submit`, body)).data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      const d = error.response.data as SubmitFailure;
      return rejectWithValue({
        error: d.error || "errors.submitFailed",
        missing_fields: d.missing_fields,
        missing_docs: d.missing_docs,
      });
    }
    return rejectWithValue({ error: formatAxiosError(error, "errors.submitFailed") });
  }
});

export const resendContractorApplicationLink = createApiThunk<{ ok: true }, string>(
  "contractorApplication/resend",
  null,
  async (email) => (await api.post("/public/contractor-application/resend", { email })).data,
);

export const fetchPortalApplicationSummary = createApiThunk<ContractorPortalApplicationSummary, void>(
  "contractorApplication/portalSummary",
  "contractor",
  async () => (await api.get("/contractor/application")).data,
);

/** Signed-in contractor → fresh magic link path for the wizard. */
export const openPortalApplication = createApiThunk<string, void>(
  "contractorApplication/portalOpen",
  "contractor",
  async () => (await api.post<{ ok: true; path: string }>("/contractor/application/link")).data.path,
);

const slice = createSlice({
  name: "contractorApplication",
  initialState,
  reducers: {
    uploadProgress(state, a: { payload: { docType: ContractorApplicationDocType; progress: number } }) {
      state.uploads[a.payload.docType] = { progress: a.payload.progress, error: null };
    },
    clearUploadError(state, a: { payload: ContractorApplicationDocType }) {
      delete state.uploads[a.payload];
    },
    clearSubmitError(state) {
      state.submitError = null;
      state.missingFields = [];
      state.missingDocs = [];
    },
    resetResend(state) {
      state.resend = { sending: false, sent: false, error: null };
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchContractorApplication.pending, (s, a) => {
      if (s.token !== a.meta.arg.token) {
        Object.assign(s, { ...initialState, portal: s.portal });
      }
      s.token = a.meta.arg.token;
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchContractorApplication.fulfilled, (s, a) => {
        s.loading = false;
        s.view = a.payload;
      })
      .addCase(fetchContractorApplication.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(saveContractorApplication.pending, (s) => {
        s.saving = true;
        s.saveError = null;
      })
      .addCase(saveContractorApplication.fulfilled, (s, a) => {
        s.saving = false;
        s.lastSavedAt = Date.now();
        if (s.view) {
          s.view.application.data = a.payload.data;
          s.view.application.current_step = a.payload.current_step;
          s.view.requirements = a.payload.requirements;
        }
      })
      .addCase(saveContractorApplication.rejected, (s, a) => {
        s.saving = false;
        s.saveError = a.payload || "errors.saveFailed";
      })
      .addCase(uploadContractorDocument.pending, (s, a) => {
        s.uploads[a.meta.arg.docType] = { progress: 0, error: null };
      })
      .addCase(uploadContractorDocument.fulfilled, (s, a) => {
        delete s.uploads[a.meta.arg.docType];
        if (!s.view) return;
        const type = a.payload.doc_type;
        const multiple = CONTRACTOR_DOC_SPECS.find((x) => x.key === type)?.multiple;
        // Single-file types replace the previous upload (mirrors the API).
        s.view.documents = [
          ...s.view.documents.filter((d) => multiple || d.doc_type !== type),
          a.payload,
        ];
      })
      .addCase(uploadContractorDocument.rejected, (s, a) => {
        s.uploads[a.meta.arg.docType] = { progress: 0, error: a.payload || "errors.uploadFailed" };
      })
      .addCase(removeContractorDocument.pending, (s, a) => {
        s.docBusyId = a.meta.arg.id;
        s.docError = null;
      })
      .addCase(removeContractorDocument.fulfilled, (s, a) => {
        s.docBusyId = null;
        if (s.view) s.view.documents = s.view.documents.filter((d) => d.id !== a.payload);
      })
      .addCase(removeContractorDocument.rejected, (s, a) => {
        s.docBusyId = null;
        s.docError = a.payload || "errors.server";
      })
      .addCase(updateContractorDocumentExpiry.pending, (s, a) => {
        s.docBusyId = a.meta.arg.id;
        s.docError = null;
      })
      .addCase(updateContractorDocumentExpiry.fulfilled, (s, a) => {
        s.docBusyId = null;
        const d = s.view?.documents.find((x) => x.id === a.payload.id);
        if (d) d.expires_on = a.payload.expires_on;
      })
      .addCase(updateContractorDocumentExpiry.rejected, (s, a) => {
        s.docBusyId = null;
        s.docError = a.payload || "errors.server";
      })
      .addCase(submitContractorApplication.pending, (s) => {
        s.submitting = true;
        s.submitError = null;
        s.missingFields = [];
        s.missingDocs = [];
      })
      .addCase(submitContractorApplication.fulfilled, (s, a) => {
        s.submitting = false;
        s.submitted = true;
        s.missingDocs = a.payload.missing_docs || [];
        if (s.view) {
          s.view.application.status = "submitted";
          s.view.application.submitted_at = new Date().toISOString();
          s.view.application.info_request_note = null;
          s.view.application.info_request_doc_types = [];
        }
      })
      .addCase(submitContractorApplication.rejected, (s, a) => {
        s.submitting = false;
        s.submitError = a.payload?.error || "errors.submitFailed";
        s.missingFields = a.payload?.missing_fields || [];
        s.missingDocs = a.payload?.missing_docs || [];
      })
      .addCase(resendContractorApplicationLink.pending, (s) => {
        s.resend = { sending: true, sent: false, error: null };
      })
      .addCase(resendContractorApplicationLink.fulfilled, (s) => {
        s.resend = { sending: false, sent: true, error: null };
      })
      .addCase(resendContractorApplicationLink.rejected, (s, a) => {
        s.resend = { sending: false, sent: false, error: a.payload || "errors.server" };
      })
      .addCase(fetchPortalApplicationSummary.fulfilled, (s, a) => {
        s.portal.summary = a.payload.application;
        s.portal.loaded = true;
      })
      .addCase(fetchPortalApplicationSummary.rejected, (s) => {
        s.portal.loaded = true;
      })
      .addCase(openPortalApplication.pending, (s) => {
        s.portal.opening = true;
        s.portal.error = null;
      })
      .addCase(openPortalApplication.fulfilled, (s) => {
        s.portal.opening = false;
      })
      .addCase(openPortalApplication.rejected, (s, a) => {
        s.portal.opening = false;
        s.portal.error = a.payload || "errors.server";
      });
  },
});

export const { uploadProgress, clearUploadError, clearSubmitError, resetResend } = slice.actions;
export default slice.reducer;
