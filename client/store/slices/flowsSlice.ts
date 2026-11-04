import { createSlice } from "@reduxjs/toolkit";
import type {
  FlowPreviewResponse,
  FlowRun,
  FlowRunAction,
  FlowSubjectKind,
  PersonFlowsResponse,
  ReminderFlowDetail,
  ReminderFlowSaveBody,
  ReminderFlowsListResponse,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Automations: reminder flows (list, builder, people in a flow) and a person's flows on record pages. */

export const fetchFlows = createApiThunk<ReminderFlowsListResponse, void>("flows/list", "admin", async () => (await api.get("/admin/flows")).data);

export const fetchFlow = createApiThunk<ReminderFlowDetail, number>("flows/get", "admin", async (id) => (await api.get(`/admin/flows/${id}`)).data);

export const createFlow = createApiThunk<ReminderFlowDetail, ReminderFlowSaveBody>("flows/create", "admin", async (body) => (await api.post("/admin/flows", body)).data);

export const saveFlow = createApiThunk<ReminderFlowDetail, { id: number; body: ReminderFlowSaveBody }>(
  "flows/save",
  "admin",
  async ({ id, body }) => (await api.put(`/admin/flows/${id}`, body)).data,
);

export const setFlowActive = createApiThunk<ReminderFlowDetail, { id: number; active: boolean }>(
  "flows/active",
  "admin",
  async ({ id, active }) => (await api.patch(`/admin/flows/${id}/active`, { active })).data,
);

export const deleteFlow = createApiThunk<{ ok: true }, number>("flows/delete", "admin", async (id) => (await api.delete(`/admin/flows/${id}`, { data: { confirm: true } })).data);

export type FlowPreviewArgs = { id: number; step_key: string; lang?: "en" | "es"; subject_kind?: FlowSubjectKind; subject_id?: number };

export const previewFlowStep = createApiThunk<FlowPreviewResponse, FlowPreviewArgs>(
  "flows/preview",
  "admin",
  async ({ id, ...body }) => (await api.post(`/admin/flows/${id}/preview`, body)).data,
);

export const testFlowStep = createApiThunk<{ ok: true; sent_to: string }, FlowPreviewArgs>(
  "flows/test",
  "admin",
  async ({ id, ...body }) => (await api.post(`/admin/flows/${id}/test`, body)).data,
);

export const fetchFlowRuns = createApiThunk<{ ok: true; runs: FlowRun[] }, { id: number; status: string }>(
  "flows/runs",
  "admin",
  async ({ id, status }) => (await api.get(`/admin/flows/${id}/runs`, { params: { status } })).data,
);

export const fetchPersonFlows = createApiThunk<PersonFlowsResponse & { key: string }, { kind: FlowSubjectKind; id: number }>(
  "flows/person",
  "admin",
  async ({ kind, id }) => ({ ...(await api.get(`/admin/flows-for/${kind}/${id}`)).data, key: `${kind}:${id}` }),
);

export const flowRunAction = createApiThunk<{ ok: true }, { runId: number; action: FlowRunAction }>(
  "flows/runAction",
  "admin",
  async ({ runId, action }) => (await api.post(`/admin/flow-runs/${runId}/${action}`)).data,
);

export const enrollInFlow = createApiThunk<{ ok: true; run_id: number }, { flowId: number; kind: FlowSubjectKind; id: number }>(
  "flows/enroll",
  "admin",
  async ({ flowId, kind, id }) => (await api.post(`/admin/flows/${flowId}/enroll`, { subject_kind: kind, subject_id: id })).data,
);

export const saveFlowsSettings = createApiThunk<{ ok: true; default_rep_name: string }, { default_rep_name: string }>(
  "flows/settings",
  "admin",
  async (body) => (await api.put("/admin/flows-settings", body)).data,
);

type State = {
  list: ReminderFlowsListResponse | null;
  listLoading: boolean;
  detail: ReminderFlowDetail | null;
  detailLoading: boolean;
  saving: boolean;
  runs: FlowRun[];
  runsLoading: boolean;
  preview: FlowPreviewResponse | null;
  previewLoading: boolean;
  testSentTo: string | null;
  person: Record<string, PersonFlowsResponse>;
  busyRunId: number | null;
  error: string | null;
};

const initialState: State = {
  list: null,
  listLoading: false,
  detail: null,
  detailLoading: false,
  saving: false,
  runs: [],
  runsLoading: false,
  preview: null,
  previewLoading: false,
  testSentTo: null,
  person: {},
  busyRunId: null,
  error: null,
};

const slice = createSlice({
  name: "flows",
  initialState,
  reducers: {
    clearFlowError: (s) => {
      s.error = null;
    },
    clearFlowPreview: (s) => {
      s.preview = null;
      s.testSentTo = null;
    },
  },
  extraReducers: (b) => {
    const fail = (s: State, a: { payload?: string }) => {
      s.saving = false;
      s.error = a.payload || "errors.server";
    };
    const gotDetail = (s: State, a: { payload: ReminderFlowDetail }) => {
      s.saving = false;
      s.detailLoading = false;
      s.detail = a.payload;
      if (s.list) {
        const i = s.list.flows.findIndex((f) => f.id === a.payload.flow.id);
        if (i >= 0) s.list.flows[i] = a.payload.flow;
        else s.list.flows.push(a.payload.flow);
      }
    };
    b.addCase(fetchFlows.pending, (s) => {
      s.listLoading = true;
      s.error = null;
    })
      .addCase(fetchFlows.fulfilled, (s, a) => {
        s.listLoading = false;
        s.list = a.payload;
      })
      .addCase(fetchFlows.rejected, (s, a) => {
        s.listLoading = false;
        fail(s, a);
      })
      .addCase(fetchFlow.pending, (s) => {
        s.detailLoading = true;
        s.error = null;
      })
      .addCase(fetchFlow.fulfilled, gotDetail)
      .addCase(fetchFlow.rejected, (s, a) => {
        s.detailLoading = false;
        fail(s, a);
      })
      .addCase(createFlow.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
      .addCase(createFlow.fulfilled, gotDetail)
      .addCase(createFlow.rejected, fail)
      .addCase(saveFlow.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
      .addCase(saveFlow.fulfilled, gotDetail)
      .addCase(saveFlow.rejected, fail)
      .addCase(setFlowActive.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
      .addCase(setFlowActive.fulfilled, gotDetail)
      .addCase(setFlowActive.rejected, fail)
      .addCase(deleteFlow.fulfilled, (s, a) => {
        if (s.list) s.list.flows = s.list.flows.filter((f) => f.id !== a.meta.arg);
        if (s.detail?.flow.id === a.meta.arg) s.detail = null;
      })
      .addCase(deleteFlow.rejected, fail)
      .addCase(previewFlowStep.pending, (s) => {
        s.previewLoading = true;
        s.testSentTo = null;
      })
      .addCase(previewFlowStep.fulfilled, (s, a) => {
        s.previewLoading = false;
        s.preview = a.payload;
      })
      .addCase(previewFlowStep.rejected, (s, a) => {
        s.previewLoading = false;
        fail(s, a);
      })
      .addCase(testFlowStep.pending, (s) => {
        s.testSentTo = null;
        s.error = null;
      })
      .addCase(testFlowStep.fulfilled, (s, a) => {
        s.testSentTo = a.payload.sent_to;
      })
      .addCase(testFlowStep.rejected, fail)
      .addCase(fetchFlowRuns.pending, (s) => {
        s.runsLoading = true;
      })
      .addCase(fetchFlowRuns.fulfilled, (s, a) => {
        s.runsLoading = false;
        s.runs = a.payload.runs;
      })
      .addCase(fetchFlowRuns.rejected, (s, a) => {
        s.runsLoading = false;
        fail(s, a);
      })
      .addCase(fetchPersonFlows.fulfilled, (s, a) => {
        const { key, ...rest } = a.payload;
        s.person[key] = rest;
      })
      .addCase(flowRunAction.pending, (s, a) => {
        s.busyRunId = a.meta.arg.runId;
        s.error = null;
      })
      .addCase(flowRunAction.fulfilled, (s) => {
        s.busyRunId = null;
      })
      .addCase(flowRunAction.rejected, (s, a) => {
        s.busyRunId = null;
        fail(s, a);
      })
      .addCase(enrollInFlow.rejected, fail)
      .addCase(saveFlowsSettings.fulfilled, (s, a) => {
        if (s.list) s.list.default_rep_name = a.payload.default_rep_name;
      })
      .addCase(saveFlowsSettings.rejected, fail);
  },
});

export const { clearFlowError, clearFlowPreview } = slice.actions;
export default slice.reducer;
