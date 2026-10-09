import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import type {
  AdminContractorApplicationView,
  ContractorApplicationDocStatus,
  ContractorApplicationDocType,
  ContractorApplicationTemplates,
} from "@shared/contractorApplication";
import { api, formatAxiosError } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type BulkPreview = {
  count: number;
  sample: Array<{ id: number; first_name: string; last_name: string; email: string; company: string | null }>;
};

type State = {
  contractorId: number | null;
  view: AdminContractorApplicationView | null;
  loading: boolean;
  error: string | null;
  /** Name of the in-flight action (`send`, `review`, `decision`, …) for busy buttons. */
  busy: string | null;
  actionError: string | null;
  missingDocs: ContractorApplicationDocType[];
  templates: ContractorApplicationTemplates | null;
  templateBusy: string | null;
  templateError: string | null;
  bulk: {
    preview: BulkPreview | null;
    loading: boolean;
    sending: boolean;
    result: { sent: number; failed: number; remaining: number } | null;
    error: string | null;
  };
};

const initialState: State = {
  contractorId: null,
  view: null,
  loading: false,
  error: null,
  busy: null,
  actionError: null,
  missingDocs: [],
  templates: null,
  templateBusy: null,
  templateError: null,
  bulk: { preview: null, loading: false, sending: false, result: null, error: null },
};

const path = (id: number) => `/admin/contractors/${id}/application`;

export const fetchAdminContractorApplication = createApiThunk<AdminContractorApplicationView, number>(
  "adminCpq/fetch",
  "admin",
  async (id) => (await api.get(path(id))).data,
);

/** Admin actions share one busy/error slot; a 409 with `missing_docs` is surfaced to the UI. */
function action<Arg extends { id: number }>(name: string, fn: (arg: Arg) => Promise<unknown>) {
  return createAsyncThunk<
    { id: number },
    Arg,
    { rejectValue: { error: string; missing_docs?: ContractorApplicationDocType[] } }
  >(`adminCpq/${name}`, async (arg, { rejectWithValue, dispatch }) => {
    try {
      await fn(arg);
      void dispatch(fetchAdminContractorApplication(arg.id));
      return { id: arg.id };
    } catch (error) {
      const data = axios.isAxiosError(error) ? (error.response?.data as any) : null;
      return rejectWithValue({
        error: data?.error || formatAxiosError(error, "errors.server"),
        missing_docs: data?.missing_docs,
      });
    }
  });
}

export const sendContractorApplication = action<{ id: number }>("send", ({ id }) =>
  api.post(`${path(id)}/send`, {}),
);

export const reviewContractorApplication = action<{
  id: number;
  license_verified?: boolean | null;
  insurance_verified?: boolean | null;
  decision_notes?: string | null;
}>("review", ({ id, ...patch }) => api.patch(`${path(id)}/review`, patch));

export const reviewContractorDocument = action<{
  id: number;
  docId: number;
  status: ContractorApplicationDocStatus;
  review_note?: string | null;
}>("document", ({ id, docId, ...body }) => api.patch(`${path(id)}/documents/${docId}`, body));

export const requestContractorApplicationInfo = action<{
  id: number;
  note: string;
  doc_types: ContractorApplicationDocType[];
}>("requestInfo", ({ id, ...body }) => api.post(`${path(id)}/request-info`, body));

export const decideContractorApplication = action<{
  id: number;
  decision: "approved" | "denied";
  notes?: string | null;
  message?: string | null;
  allow_missing?: boolean;
}>("decision", ({ id, ...body }) => api.post(`${path(id)}/decision`, body));

export const reopenContractorApplication = action<{ id: number; note: string }>("reopen", ({ id, note }) =>
  api.post(`${path(id)}/reopen`, { note }),
);

/** super_admin: activate a pending contractor without an approved application (audited). */
export const overrideActivateContractor = action<{ id: number; override_reason: string }>(
  "override",
  ({ id, override_reason }) => api.patch(`/admin/contractors/${id}`, { status: "active", override_reason }),
);

export const fetchCpqTemplates = createApiThunk<ContractorApplicationTemplates, void>(
  "adminCpq/templates",
  "admin",
  async () => (await api.get("/admin/cpq-templates")).data.templates,
);

export const uploadCpqTemplate = createApiThunk<
  ContractorApplicationTemplates,
  { kind: keyof ContractorApplicationTemplates; file: File }
>("adminCpq/templateUpload", "admin", async ({ kind, file }) =>
  (
    await api.post(`/admin/cpq-templates/${kind}`, file, {
      headers: { "Content-Type": "application/pdf" },
    })
  ).data.templates,
);

export const removeCpqTemplate = createApiThunk<ContractorApplicationTemplates, keyof ContractorApplicationTemplates>(
  "adminCpq/templateRemove",
  "admin",
  async (kind) => (await api.delete(`/admin/cpq-templates/${kind}`)).data.templates,
);

export const previewBulkApplications = createApiThunk<BulkPreview, void>(
  "adminCpq/bulkPreview",
  "admin",
  async () => (await api.post("/admin/contractors/application/send-bulk", {})).data,
);

export const sendBulkApplications = createApiThunk<
  { sent: number; failed: number; remaining: number },
  void
>("adminCpq/bulkSend", "admin", async () =>
  (await api.post("/admin/contractors/application/send-bulk", { confirm: true })).data,
);

const ACTIONS = [
  sendContractorApplication,
  reviewContractorApplication,
  reviewContractorDocument,
  requestContractorApplicationInfo,
  decideContractorApplication,
  reopenContractorApplication,
  overrideActivateContractor,
];

const slice = createSlice({
  name: "adminContractorApplication",
  initialState,
  reducers: {
    clearCpqActionError(state) {
      state.actionError = null;
      state.missingDocs = [];
    },
    resetBulkApplications(state) {
      state.bulk = initialState.bulk;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchAdminContractorApplication.pending, (s, a) => {
      if (s.contractorId !== a.meta.arg) s.view = null;
      s.contractorId = a.meta.arg;
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchAdminContractorApplication.fulfilled, (s, a) => {
        s.loading = false;
        if (s.contractorId === a.meta.arg) s.view = a.payload;
        s.templates = a.payload.templates;
      })
      .addCase(fetchAdminContractorApplication.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      });
    for (const thunk of ACTIONS) {
      const name = thunk.typePrefix.split("/")[1];
      b.addCase(thunk.pending, (s) => {
        s.busy = name;
        s.actionError = null;
        s.missingDocs = [];
      })
        .addCase(thunk.fulfilled, (s) => {
          s.busy = null;
        })
        .addCase(thunk.rejected, (s, a) => {
          s.busy = null;
          s.actionError = a.payload?.error || "errors.server";
          s.missingDocs = a.payload?.missing_docs || [];
        });
    }
    for (const thunk of [fetchCpqTemplates, uploadCpqTemplate, removeCpqTemplate]) {
      b.addCase(thunk.pending, (s, a) => {
        s.templateBusy =
          typeof a.meta.arg === "string" ? a.meta.arg : (a.meta.arg as { kind?: string } | undefined)?.kind ?? "load";
        s.templateError = null;
      })
        .addCase(thunk.fulfilled, (s, a) => {
          s.templateBusy = null;
          s.templates = a.payload;
        })
        .addCase(thunk.rejected, (s, a) => {
          s.templateBusy = null;
          s.templateError = a.payload || "errors.server";
        });
    }
    b.addCase(previewBulkApplications.pending, (s) => {
      s.bulk = { ...initialState.bulk, loading: true };
    })
      .addCase(previewBulkApplications.fulfilled, (s, a) => {
        s.bulk.loading = false;
        s.bulk.preview = { count: a.payload.count, sample: a.payload.sample };
      })
      .addCase(previewBulkApplications.rejected, (s, a) => {
        s.bulk.loading = false;
        s.bulk.error = a.payload || "errors.server";
      })
      .addCase(sendBulkApplications.pending, (s) => {
        s.bulk.sending = true;
        s.bulk.error = null;
      })
      .addCase(sendBulkApplications.fulfilled, (s, a) => {
        s.bulk.sending = false;
        s.bulk.result = a.payload;
      })
      .addCase(sendBulkApplications.rejected, (s, a) => {
        s.bulk.sending = false;
        s.bulk.error = a.payload || "errors.server";
      });
  },
});

export const { clearCpqActionError, resetBulkApplications } = slice.actions;
export default slice.reducer;
