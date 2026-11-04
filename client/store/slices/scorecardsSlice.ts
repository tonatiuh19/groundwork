import { createSlice, isAnyOf } from "@reduxjs/toolkit";
import type {
  ProjectTracking,
  ScorecardAction,
  ScorecardActivityInput,
  ScorecardBoard,
  ScorecardDetail,
  ScorecardKind,
  ScorecardLeadHit,
  ScorecardSubjectType,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Admin -> Scorecards (SCORECARD_ENABLED): weekly A-F board, person detail, project tracking. */
type Who = { type: ScorecardSubjectType; id: number };
const base = ({ type, id }: Who) => `/admin/scorecards/${type}/${id}`;

export const fetchScorecardBoard = createApiThunk<ScorecardBoard, { week?: string } | void>(
  "scorecards/board",
  "admin",
  async (arg) => (await api.get("/admin/scorecards", { params: arg && arg.week ? { week: arg.week } : {} })).data,
);
export const fetchScorecardDetail = createApiThunk<ScorecardDetail, Who>("scorecards/detail", "admin", async (who) => (await api.get(base(who))).data);
export const setScorecardRoles = createApiThunk<{ roles: ScorecardKind[] }, { id: number; roles: ScorecardKind[] }>(
  "scorecards/roles",
  "admin",
  async ({ id, roles }) => (await api.patch(`/admin/scorecards/contractor/${id}/roles`, { roles })).data,
);
export const logScorecardActivity = createApiThunk<{ id: number }, Who & { body: ScorecardActivityInput }>(
  "scorecards/logActivity",
  "admin",
  async ({ body, ...who }) => (await api.post(`${base(who)}/activities`, body)).data,
);
export const deleteScorecardActivity = createApiThunk<{ ok: true }, number>(
  "scorecards/deleteActivity",
  "admin",
  async (id) => (await api.delete(`/admin/scorecards/activities/${id}`)).data,
);
export const addScorecardTimeOff = createApiThunk<{ ok: true }, Who & { starts_on: string; ends_on: string; label?: string }>(
  "scorecards/addTimeOff",
  "admin",
  async ({ type, id, ...body }) => (await api.post(`${base({ type, id })}/time-off`, body)).data,
);
export const deleteScorecardTimeOff = createApiThunk<{ ok: true }, number>(
  "scorecards/deleteTimeOff",
  "admin",
  async (id) => (await api.delete(`/admin/scorecards/time-off/${id}`)).data,
);
export const addScorecardNote = createApiThunk<{ item: ScorecardAction }, Who & { body: string; scorecard?: ScorecardKind; week_start?: string }>(
  "scorecards/addNote",
  "admin",
  async ({ type, id, ...body }) => (await api.post(`${base({ type, id })}/actions`, body)).data,
);
export const updateScorecardAction = createApiThunk<{ item: ScorecardAction }, { id: number; status?: "open" | "done"; resolution?: string }>(
  "scorecards/updateAction",
  "admin",
  async ({ id, ...body }) => (await api.patch(`/admin/scorecards/actions/${id}`, body)).data,
);
export const assignScorecardLead = createApiThunk<{ ok: true }, { leadId: number; contractorId: number | null }>(
  "scorecards/assignLead",
  "admin",
  async ({ leadId, contractorId }) => (await api.put(`/admin/scorecards/leads/${leadId}/contractor`, { contractor_id: contractorId })).data,
);
export const searchScorecardLeads = createApiThunk<{ items: ScorecardLeadHit[] }, string>(
  "scorecards/leadSearch",
  "admin",
  async (q) => (await api.get("/admin/scorecards/lead-search", { params: { q } })).data,
);

const pbase = (publicId: string) => `/admin/scorecards/projects/${encodeURIComponent(publicId)}`;
export const fetchProjectTracking = createApiThunk<ProjectTracking, string>("scorecards/tracking", "admin", async (pid) => (await api.get(`${pbase(pid)}/tracking`)).data);
export const addProjectPlan = createApiThunk<ProjectTracking, { publicId: string; title: string; due_on: string }>(
  "scorecards/addPlan",
  "admin",
  async ({ publicId, ...body }) => (await api.post(`${pbase(publicId)}/plans`, body)).data,
);
export const setProjectPlanDelivered = createApiThunk<ProjectTracking, { publicId: string; id: number; delivered: boolean }>(
  "scorecards/planDelivered",
  "admin",
  async ({ publicId, id, delivered }) => (await api.patch(`${pbase(publicId)}/plans/${id}`, { delivered })).data,
);
export const deleteProjectPlan = createApiThunk<ProjectTracking, { publicId: string; id: number }>(
  "scorecards/deletePlan",
  "admin",
  async ({ publicId, id }) => (await api.delete(`${pbase(publicId)}/plans/${id}`)).data,
);
export const addProjectCorrection = createApiThunk<ProjectTracking, { publicId: string; received_on: string; note?: string }>(
  "scorecards/addCorrection",
  "admin",
  async ({ publicId, ...body }) => (await api.post(`${pbase(publicId)}/corrections`, body)).data,
);
export const resolveProjectCorrection = createApiThunk<ProjectTracking, { publicId: string; id: number; resolved_on: string | null }>(
  "scorecards/resolveCorrection",
  "admin",
  async ({ publicId, id, resolved_on }) => (await api.patch(`${pbase(publicId)}/corrections/${id}`, { resolved_on })).data,
);
export const deleteProjectCorrection = createApiThunk<ProjectTracking, { publicId: string; id: number }>(
  "scorecards/deleteCorrection",
  "admin",
  async ({ publicId, id }) => (await api.delete(`${pbase(publicId)}/corrections/${id}`)).data,
);
export const setProjectTarget = createApiThunk<ProjectTracking, { publicId: string; milestone: string; due_on: string | null }>(
  "scorecards/setTarget",
  "admin",
  async ({ publicId, ...body }) => (await api.put(`${pbase(publicId)}/targets`, body)).data,
);

type State = {
  board: ScorecardBoard | null;
  boardLoading: boolean;
  detail: ScorecardDetail | null;
  detailLoading: boolean;
  tracking: Record<string, ProjectTracking>;
  leadHits: ScorecardLeadHit[];
  saving: boolean;
  error: string | null;
};
const initialState: State = { board: null, boardLoading: false, detail: null, detailLoading: false, tracking: {}, leadHits: [], saving: false, error: null };

const trackingThunks = [fetchProjectTracking, addProjectPlan, setProjectPlanDelivered, deleteProjectPlan, addProjectCorrection, resolveProjectCorrection, deleteProjectCorrection, setProjectTarget] as const;
const writeThunks = [
  setScorecardRoles,
  logScorecardActivity,
  deleteScorecardActivity,
  addScorecardTimeOff,
  deleteScorecardTimeOff,
  addScorecardNote,
  updateScorecardAction,
  assignScorecardLead,
] as const;

const slice = createSlice({
  name: "scorecards",
  initialState,
  reducers: {
    clearScorecardError(s) {
      s.error = null;
    },
    clearLeadHits(s) {
      s.leadHits = [];
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchScorecardBoard.pending, (s) => {
      s.boardLoading = true;
      s.error = null;
    })
      .addCase(fetchScorecardBoard.fulfilled, (s, a) => {
        s.boardLoading = false;
        s.board = a.payload;
      })
      .addCase(fetchScorecardBoard.rejected, (s, a) => {
        s.boardLoading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(fetchScorecardDetail.pending, (s, a) => {
        s.detailLoading = true;
        s.error = null;
        if (s.detail && (s.detail.subject.type !== a.meta.arg.type || s.detail.subject.id !== a.meta.arg.id)) s.detail = null;
      })
      .addCase(fetchScorecardDetail.fulfilled, (s, a) => {
        s.detailLoading = false;
        s.detail = a.payload;
      })
      .addCase(fetchScorecardDetail.rejected, (s, a) => {
        s.detailLoading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(searchScorecardLeads.fulfilled, (s, a) => {
        s.leadHits = a.payload.items;
      });
    b.addCase(updateScorecardAction.fulfilled, (s, a) => {
      const it = a.payload.item;
      if (s.detail) s.detail.actions = s.detail.actions.map((x) => (x.id === it.id ? it : x));
      if (s.board) s.board.open_actions = it.status === "open" ? s.board.open_actions.map((x) => (x.id === it.id ? it : x)) : s.board.open_actions.filter((x) => x.id !== it.id);
    });
    b.addCase(addScorecardNote.fulfilled, (s, a) => {
      if (s.detail) s.detail.actions.unshift(a.payload.item);
    });
    for (const th of trackingThunks) {
      b.addCase(th.pending, (s) => {
        s.error = null;
      })
        .addCase(th.fulfilled, (s, a) => {
          const pid = typeof a.meta.arg === "string" ? a.meta.arg : a.meta.arg.publicId;
          s.tracking[pid] = a.payload;
        })
        .addCase(th.rejected, (s, a) => {
          s.error = a.payload || "errors.server";
        });
    }
    // Matchers run after the cases above, so writes with their own fulfilled case still flip `saving`.
    b.addMatcher(isAnyOf(...writeThunks.map((th) => th.pending)), (s) => {
      s.saving = true;
      s.error = null;
    })
      .addMatcher(isAnyOf(...writeThunks.map((th) => th.fulfilled)), (s) => {
        s.saving = false;
      })
      .addMatcher(isAnyOf(...writeThunks.map((th) => th.rejected)), (s, a) => {
        s.saving = false;
        s.error = (a.payload as string | undefined) || "errors.server";
      });
  },
});

export const { clearScorecardError, clearLeadHits } = slice.actions;
export default slice.reducer;
