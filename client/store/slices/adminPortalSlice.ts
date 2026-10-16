import {
  createAsyncThunk,
  createSlice,
  isAnyOf,
  type ActionReducerMapBuilder,
  type AsyncThunk,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type {
  AduPlan,
  AdminAffiliate,
  AdminClient,
  AdminCommission,
  AdminContractor,
  AdminDashboard,
  AdminLead,
  AdminNotifyEventKey,
  AdminNotifyExtraEmail,
  AdminNotifyStaffRecipient,
  AdminProject,
  AdminProjectBoardColumn,
  AdminProjectBoardColumnPage,
  AdminProjectBoardResponse,
  AdminProjectDetail,
  AdminStaff,
  CommissionSettings,
  ConvertAdminLeadRequest,
  ConvertAdminLeadResponse,
  EventRegistrationStatus,
  LeadConvertPhoneMatch,
  MarketingEvent,
  ProjectDraw,
  ProjectMilestone,
} from "@shared/api";
import { BOARD_MILESTONES } from "@shared/api";
import axios from "axios";
import { api, formatAxiosError } from "@/lib/api";
import { portalSessionExpired } from "@/store/slices/portalAuthSlice";
import {
  applyAdminNotifyPrefsPatch,
  type AdminNotifyPrefsPatch,
} from "@/lib/adminNotifyPrefs";
import { createApiThunk } from "@/lib/portalThunk";
import { personConflictDetected, personConflictFromBody } from "@/store/slices/personConflictSlice";
import { boardQueryParams, emptyBoardColumns, type BoardFilters } from "@/lib/projectBoard";

type ListState<T> = { items: T[]; total: number; loading: boolean; error: string | null };
const list = <T>(): ListState<T> => ({ items: [], total: 0, loading: false, error: null });

/** Envelope every admin list thunk resolves with so pagination totals survive. */
type Page<T> = { items: T[]; total: number };
const page = <T>(items: T[] | undefined, total: unknown): Page<T> => ({
  items: items || [],
  total: typeof total === "number" ? total : (items?.length ?? 0),
});

/** RSVP row from `GET /admin/events/:id/attendees` (lead fields + registration status). */
export type AdminEventAttendee = {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  property_address: string | null;
  event_registration_status: EventRegistrationStatus | null;
  status?: string;
  created_at: string;
};

/** Staff member shown in "assigned to" pickers (`GET /admin/assignees`). */
export type AdminAssignee = Pick<
  AdminStaff,
  "id" | "email" | "first_name" | "last_name" | "role"
>;

type SingleState<T> = { data: T | null; loading: boolean; error: string | null };
const single = <T>(): SingleState<T> => ({ data: null, loading: false, error: null });

type BoardState = {
  columns: Record<ProjectMilestone, AdminProjectBoardColumn>;
  loading: boolean;
  loadingMore: ProjectMilestone | null;
  error: string | null;
  filters: BoardFilters;
  movingId: string | null;
};

const emptyCol = (): AdminProjectBoardColumn => ({
  items: [],
  total: 0,
  offset: 0,
  limit: 20,
  has_more: false,
});

type AdminState = {
  dashboard: { data: AdminDashboard | null; loading: boolean; error: string | null };
  leads: ListState<AdminLead>;
  events: ListState<MarketingEvent>;
  eventAttendees: ListState<AdminEventAttendee>;
  affiliates: ListState<AdminAffiliate>;
  contractors: ListState<AdminContractor>;
  clients: ListState<AdminClient>;
  projects: ListState<AdminProject>;
  projectBoard: BoardState;
  draws: ListState<ProjectDraw>;
  commissions: ListState<AdminCommission>;
  staff: ListState<AdminStaff>;
  assignees: ListState<AdminAssignee>;
  plans: ListState<AduPlan>;
  projectDetail: SingleState<AdminProjectDetail>;
  eventDetail: SingleState<MarketingEvent>;
  clientDetail: SingleState<AdminClient>;
  affiliateDetail: SingleState<AdminAffiliate>;
  contractorDetail: SingleState<AdminContractor>;
  settings: SingleState<{
    settings: CommissionSettings;
    notify_extra_emails: AdminNotifyExtraEmail[];
  }>;
  notifyRecipients: {
    staff: AdminNotifyStaffRecipient[];
    extras: AdminNotifyExtraEmail[];
    events: AdminNotifyEventKey[];
    loading: boolean;
    saving: boolean;
    error: string | null;
    staffPrefsSnapshot: AdminNotifyStaffRecipient[] | null;
  };
  saving: boolean;
  saveError: string | null;
};

const initialState: AdminState = {
  dashboard: { data: null, loading: false, error: null },
  leads: list(),
  events: list(),
  eventAttendees: list(),
  affiliates: list(),
  contractors: list(),
  clients: list(),
  projects: list(),
  projectBoard: {
    columns: Object.fromEntries(BOARD_MILESTONES.map((m) => [m, emptyCol()])) as Record<
      ProjectMilestone,
      AdminProjectBoardColumn
    >,
    loading: false,
    loadingMore: null,
    error: null,
    filters: {
      q: "",
      affiliate_id: "",
      contractor_id: "",
      assigned_admin_id: "",
      loan_status: "",
    },
    movingId: null,
  },
  draws: list(),
  commissions: list(),
  staff: list(),
  assignees: list(),
  plans: list(),
  projectDetail: single(),
  eventDetail: single(),
  clientDetail: single(),
  affiliateDetail: single(),
  contractorDetail: single(),
  settings: single(),
  notifyRecipients: {
    staff: [],
    extras: [],
    events: [],
    loading: false,
    saving: false,
    error: null,
    staffPrefsSnapshot: null,
  },
  saving: false,
  saveError: null,
};

const A = "admin" as const;
export type AdminListFilter = {
  q?: string;
  status?: string;
  /** Contractors: prequalification status (`none` = never sent). */
  application_status?: string;
  role?: string;
  milestone?: string;
  affiliate_id?: string | number;
  contractor_id?: string | number;
  assigned_admin_id?: string | number;
  loan_status?: string;
  /** Leads: `event` | `standard`. */
  mode?: string;
  /** Leads: `active` (default on the Leads page) | `converted` | `all`. */
  view?: string;
  /** Leads: restrict to one event's RSVPs. */
  event_id?: string | number;
  /** Attendees: `confirmed` | `waitlisted`. */
  registration_status?: string;
  limit?: number;
  offset?: number;
};
type Filter = AdminListFilter | void;

/** Drops empty filters so "All" selects do not send `?status=` to the API. */
const params = (f: Filter) => {
  if (!f) return undefined;
  const entries = Object.entries(f).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  return entries.length ? { params: Object.fromEntries(entries) } : undefined;
};

// ── Reads ────────────────────────────────────────────────────────────────────
export const fetchAdminDashboard = createApiThunk("adminPortal/dashboard", A, async () =>
  (await api.get<AdminDashboard>("/admin/dashboard")).data,
);
export const fetchAdminLeads = createApiThunk<Page<AdminLead>, Filter>(
  "adminPortal/leads",
  A,
  async (f) => {
    const { data } = await api.get("/admin/leads", params(f));
    return page<AdminLead>(data.leads, data.total);
  },
);
export const fetchAdminEvents = createApiThunk<Page<MarketingEvent>, Filter>(
  "adminPortal/events",
  A,
  async (f) => {
    const { data } = await api.get("/admin/events", params(f));
    return page<MarketingEvent>(data.events, data.total);
  },
);
export const fetchAdminEventDetail = createApiThunk<MarketingEvent, number>(
  "adminPortal/eventDetail",
  A,
  async (id) => {
    const { data } = await api.get<{ event: MarketingEvent }>(`/admin/events/${id}`);
    return data.event;
  },
);
export const fetchAdminEventAttendees = createApiThunk<
  Page<AdminEventAttendee>,
  { id: number } & NonNullable<AdminListFilter>
>("adminPortal/eventAttendees", A, async ({ id, ...f }) => {
  const { data } = await api.get(`/admin/events/${id}/attendees`, params(f));
  return page<AdminEventAttendee>(data.attendees ?? data.leads, data.total);
});
export const fetchAdminAffiliates = createApiThunk<Page<AdminAffiliate>, Filter>(
  "adminPortal/affiliates",
  A,
  async (f) => {
    const { data } = await api.get("/admin/affiliates", params(f));
    return page<AdminAffiliate>(data.affiliates, data.total);
  },
);
export const fetchAdminContractors = createApiThunk<Page<AdminContractor>, Filter>(
  "adminPortal/contractors",
  A,
  async (f) => {
    const { data } = await api.get("/admin/contractors", params(f));
    return page<AdminContractor>(data.contractors, data.total);
  },
);
export const fetchAdminClients = createApiThunk<Page<AdminClient>, Filter>(
  "adminPortal/clients",
  A,
  async (f) => {
    const { data } = await api.get("/admin/clients", params(f));
    return page<AdminClient>(data.clients, data.total);
  },
);
export const fetchAdminProjects = createApiThunk<Page<AdminProject>, Filter>(
  "adminPortal/projects",
  A,
  async (f) => {
    const { data } = await api.get("/admin/projects", params(f));
    return page<AdminProject>(data.projects, data.total);
  },
);
export const fetchAdminProjectBoard = createApiThunk<
  AdminProjectBoardResponse,
  BoardFilters | void
>("adminPortal/projectBoard", A, async (f) => {
  const filters = f || initialState.projectBoard.filters;
  const { data } = await api.get<AdminProjectBoardResponse>("/admin/projects/board", {
    params: boardQueryParams(filters),
  });
  return data;
});
export const fetchMoreAdminProjectBoard = createApiThunk<
  AdminProjectBoardColumnPage,
  { milestone: ProjectMilestone; offset: number; filters: BoardFilters }
>("adminPortal/projectBoardMore", A, async ({ milestone, offset, filters }) => {
  const { data } = await api.get<AdminProjectBoardColumnPage>("/admin/projects/board", {
    params: { ...boardQueryParams(filters), milestone, offset },
  });
  return data;
});
export const fetchAdminProject = createApiThunk<AdminProjectDetail, string>(
  "adminPortal/project",
  A,
  async (publicId) => (await api.get(`/admin/projects/${publicId}`)).data,
);
export const fetchAdminDraws = createApiThunk<Page<ProjectDraw>, Filter>(
  "adminPortal/draws",
  A,
  async (f) => {
    const { data } = await api.get("/admin/draws", params(f));
    return page<ProjectDraw>(data.draws, data.total);
  },
);
export const fetchAdminCommissions = createApiThunk<Page<AdminCommission>, Filter>(
  "adminPortal/commissions",
  A,
  async (f) => {
    const { data } = await api.get("/admin/commissions", params(f));
    return page<AdminCommission>(data.commissions, data.total);
  },
);
export const fetchAdminStaff = createApiThunk("adminPortal/staff", A, async () => {
  const { data } = await api.get<{ staff: AdminStaff[]; total?: number }>("/admin/staff");
  return page<AdminStaff>(data.staff, data.total);
});
/** Staff who can own a client or project — lighter than the full staff list. */
export const fetchAdminAssignees = createApiThunk("adminPortal/assignees", A, async () => {
  const { data } = await api.get<{ assignees: AdminAssignee[]; total?: number }>(
    "/admin/assignees",
  );
  return page<AdminAssignee>(data.assignees, data.total);
});
export const fetchAdminPlans = createApiThunk("adminPortal/plans", A, async () => {
  const { data } = await api.get<{ plans: AduPlan[]; total?: number }>("/admin/plans");
  return page<AduPlan>(data.plans, data.total);
});
export const fetchAdminSettings = createApiThunk("adminPortal/settings", A, async () => {
  const { data } = await api.get<{
    settings: CommissionSettings;
    notify_extra_emails: AdminNotifyExtraEmail[];
  }>("/admin/settings");
  return {
    settings: data.settings,
    notify_extra_emails: data.notify_extra_emails || [],
  };
});
export const fetchAdminClientDetail = createApiThunk<AdminClient, number>(
  "adminPortal/clientDetail",
  A,
  async (id) => (await api.get<{ client: AdminClient }>(`/admin/clients/${id}`)).data.client,
);
export const fetchAdminAffiliateDetail = createApiThunk<AdminAffiliate, number>(
  "adminPortal/affiliateDetail",
  A,
  async (id) =>
    (await api.get<{ affiliate: AdminAffiliate }>(`/admin/affiliates/${id}`)).data.affiliate,
);
export const fetchAdminContractorDetail = createApiThunk<AdminContractor, number>(
  "adminPortal/contractorDetail",
  A,
  async (id) =>
    (await api.get<{ contractor: AdminContractor }>(`/admin/contractors/${id}`)).data
      .contractor,
);

// ── Mutations (shared saving / saveError state) ──────────────────────────────
type Patch = Record<string, unknown>;
const mutation = <Ret, Arg>(name: string, fn: (arg: Arg) => Promise<Ret>) =>
  createApiThunk<Ret, Arg>(`adminMutation/${name}`, A, fn);

export const createAdminEvent = mutation("createEvent", async (body: Patch) =>
  (await api.post<{ event: MarketingEvent }>("/admin/events", body)).data,
);
export const updateAdminEvent = mutation("event", async (a: { id: number; patch: Patch }) =>
  (await api.patch<{ event: MarketingEvent }>(`/admin/events/${a.id}`, a.patch)).data,
);
export const deleteAdminEvent = mutation("deleteEvent", async (id: number) =>
  (await api.delete(`/admin/events/${id}`)).data,
);

export const updateAdminLead = mutation("lead", async (a: { id: number; patch: Patch }) =>
  (await api.patch(`/admin/leads/${a.id}`, a.patch)).data,
);

export type ConvertAdminLeadArg = ConvertAdminLeadRequest & { id: number };
export type ConvertAdminLeadReject = {
  error: string;
  phone_match?: LeadConvertPhoneMatch;
};

export const convertAdminLead = createAsyncThunk<
  ConvertAdminLeadResponse,
  ConvertAdminLeadArg,
  { rejectValue: ConvertAdminLeadReject }
>("adminMutation/convertLead", async (a, { rejectWithValue, dispatch }) => {
  try {
    const { id, ...body } = a;
    const { data } = await api.post<ConvertAdminLeadResponse>(
      `/admin/leads/${id}/convert`,
      body,
    );
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      dispatch(portalSessionExpired("admin"));
    }
    const data = axios.isAxiosError(error)
      ? (error.response?.data as {
          error?: string;
          phone_match?: LeadConvertPhoneMatch;
        } | undefined)
      : undefined;
    const conflict = personConflictFromBody(data);
    if (conflict) dispatch(personConflictDetected(conflict));
    return rejectWithValue({
      error: formatAxiosError(error, "errors.server"),
      phone_match: data?.phone_match,
    });
  }
});
export const updateAdminAffiliate = mutation(
  "affiliate",
  async (a: { id: number; patch: Patch }) =>
    (await api.patch(`/admin/affiliates/${a.id}`, a.patch)).data,
);
export const inviteContractor = mutation("inviteContractor", async (body: Patch) =>
  (await api.post("/admin/contractors/invite", body)).data,
);
export const updateAdminContractor = mutation(
  "contractor",
  async (a: { id: number; patch: Patch }) =>
    (await api.patch(`/admin/contractors/${a.id}`, a.patch)).data,
);
export const createAdminClient = mutation("createClient", async (body: Patch) =>
  (await api.post("/admin/clients", body)).data,
);
export const updateAdminClient = mutation("client", async (a: { id: number; patch: Patch }) =>
  (await api.patch(`/admin/clients/${a.id}`, a.patch)).data,
);
export const sendClientPortalInvite = mutation("clientInvite", async (id: number) =>
  (await api.post(`/admin/clients/${id}/portal-invite`)).data,
);
export const createAdminProject = mutation("createProject", async (body: Patch) =>
  (await api.post<{ project_public_id: string }>("/admin/projects", body)).data,
);
export const updateAdminProject = mutation(
  "project",
  async (a: { publicId: string; patch: Patch }) =>
    (await api.patch<AdminProjectDetail>(`/admin/projects/${a.publicId}`, a.patch)).data,
);
export const syncAdminProjectAnchor = mutation(
  "anchorSync",
  async (publicId: string) => {
    const { data } = await api.post(`/admin/projects/${publicId}/anchor/sync`);
    const { sync: _s, ok: _o, ...detail } = data as AdminProjectDetail & {
      ok?: boolean;
      sync?: unknown;
    };
    return detail as AdminProjectDetail;
  },
);
export const generateContract = mutation("generateContract", async (publicId: string) =>
  (await api.post(`/admin/projects/${publicId}/contracts`, {})).data,
);
export const updateContract = mutation("contract", async (a: { id: number; patch: Patch }) =>
  (await api.patch(`/admin/contracts/${a.id}`, a.patch)).data,
);
export const updateDraw = mutation("draw", async (a: { id: number; patch: Patch }) =>
  (await api.patch(`/admin/draws/${a.id}`, a.patch)).data,
);
export const updateCommission = mutation(
  "commission",
  async (a: { id: number; patch: Patch }) =>
    (await api.patch(`/admin/commissions/${a.id}`, a.patch)).data,
);
export const createStaff = mutation("createStaff", async (body: Patch) =>
  (await api.post("/admin/staff", body)).data,
);
export const updateStaff = mutation("staff", async (a: { id: number; patch: Patch }) =>
  (await api.patch(`/admin/staff/${a.id}`, a.patch)).data,
);
export const updateAdminPlan = mutation("plan", async (a: { id: number; patch: Patch }) =>
  (await api.patch(`/admin/plans/${a.id}`, a.patch)).data,
);
export const saveAdminSettings = mutation("settings", async (body: Patch) =>
  (await api.put("/admin/settings", body)).data,
);
export const createNotifyExtra = mutation(
  "createNotifyExtra",
  async (body: {
    email: string;
    label?: string | null;
    events?: AdminNotifyEventKey[] | null;
  }) => (await api.post("/admin/settings/notify-extras", body)).data,
);
export const updateNotifyExtra = mutation(
  "updateNotifyExtra",
  async (a: { id: number; patch: Patch }) =>
    (await api.patch(`/admin/settings/notify-extras/${a.id}`, a.patch)).data,
);
export const deleteNotifyExtra = mutation("deleteNotifyExtra", async (id: number) =>
  (await api.delete(`/admin/settings/notify-extras/${id}`)).data,
);

export const fetchNotifyRecipients = createApiThunk(
  "adminPortal/notifyRecipients",
  A,
  async () => {
    const { data } = await api.get<{
      staff: AdminNotifyStaffRecipient[];
      extras: AdminNotifyExtraEmail[];
      events: AdminNotifyEventKey[];
    }>("/admin/notify-recipients");
    return {
      staff: data.staff || [],
      extras: data.extras || [],
      events: data.events || [],
    };
  },
);

export const updateStaffNotifyPrefs = createApiThunk<
  AdminNotifyStaffRecipient,
  { id: number; patch: AdminNotifyPrefsPatch }
>("adminPortal/updateStaffNotifyPrefs", A, async ({ id, patch }) => {
  const { data } = await api.put<{ staff: AdminNotifyStaffRecipient }>(
    `/admin/admins/${id}/notification-prefs`,
    patch,
  );
  return data.staff;
});

const mutations = [
  createAdminEvent,
  updateAdminEvent,
  deleteAdminEvent,
  updateAdminLead,
  updateAdminAffiliate,
  inviteContractor,
  updateAdminContractor,
  createAdminClient,
  updateAdminClient,
  sendClientPortalInvite,
  createAdminProject,
  updateAdminProject,
  syncAdminProjectAnchor,
  generateContract,
  updateContract,
  updateDraw,
  updateCommission,
  createStaff,
  updateStaff,
  updateAdminPlan,
  saveAdminSettings,
  createNotifyExtra,
  updateNotifyExtra,
  deleteNotifyExtra,
];

type ListKey =
  | "leads"
  | "events"
  | "eventAttendees"
  | "affiliates"
  | "contractors"
  | "clients"
  | "projects"
  | "draws"
  | "commissions"
  | "staff"
  | "assignees"
  | "plans";

function bindList<K extends ListKey, Arg>(
  builder: ActionReducerMapBuilder<AdminState>,
  key: K,
  thunk: AsyncThunk<Page<AdminState[K]["items"][number]>, Arg, { rejectValue: string }>,
) {
  builder
    .addCase(thunk.pending, (state) => {
      state[key].loading = true;
      state[key].error = null;
    })
    .addCase(thunk.fulfilled, (state, action) => {
      state[key].loading = false;
      const target = state[key] as ListState<unknown>;
      target.items = action.payload.items;
      target.total = action.payload.total;
    })
    .addCase(thunk.rejected, (state, action) => {
      state[key].loading = false;
      state[key].error = action.payload || "errors.server";
    });
}

type SingleKey =
  | "dashboard"
  | "projectDetail"
  | "eventDetail"
  | "clientDetail"
  | "affiliateDetail"
  | "contractorDetail"
  | "settings";

function bindSingle<K extends SingleKey, Arg>(
  builder: ActionReducerMapBuilder<AdminState>,
  key: K,
  thunk: AsyncThunk<NonNullable<AdminState[K]["data"]>, Arg, { rejectValue: string }>,
) {
  builder
    .addCase(thunk.pending, (state) => {
      state[key].loading = true;
      state[key].error = null;
    })
    .addCase(thunk.fulfilled, (state, action) => {
      state[key].loading = false;
      (state[key] as { data: unknown }).data = action.payload;
    })
    .addCase(thunk.rejected, (state, action) => {
      state[key].loading = false;
      state[key].error = action.payload || "errors.server";
    });
}

function moveProjectBetweenColumns(
  columns: Record<ProjectMilestone, AdminProjectBoardColumn>,
  publicId: string,
  to: ProjectMilestone,
): AdminProject | null {
  let found: AdminProject | null = null;
  for (const m of BOARD_MILESTONES) {
    const col = columns[m];
    const idx = col.items.findIndex((p) => p.public_id === publicId);
    if (idx >= 0) {
      found = { ...col.items[idx], milestone: to };
      col.items = [...col.items.slice(0, idx), ...col.items.slice(idx + 1)];
      col.total = Math.max(0, col.total - 1);
      col.has_more = col.items.length < col.total;
      break;
    }
  }
  if (!found) return null;
  const dest = columns[to];
  dest.items = [found, ...dest.items];
  dest.total += 1;
  dest.has_more = dest.items.length < dest.total;
  return found;
}

const adminPortalSlice = createSlice({
  name: "adminPortal",
  initialState,
  reducers: {
    clearAdminSaveError(state) {
      state.saveError = null;
    },
    clearAdminProject(state) {
      state.projectDetail = single();
    },
    clearAdminEvent(state) {
      state.eventDetail = single();
      state.eventAttendees = list();
    },
    clearAdminRecordDetail(state) {
      state.clientDetail = single();
      state.affiliateDetail = single();
      state.contractorDetail = single();
    },
    setProjectBoardFilters(state, action: PayloadAction<Partial<BoardFilters>>) {
      state.projectBoard.filters = { ...state.projectBoard.filters, ...action.payload };
    },
    optimisticBoardMove(
      state,
      action: PayloadAction<{ publicId: string; to: ProjectMilestone }>,
    ) {
      state.projectBoard.movingId = action.payload.publicId;
      moveProjectBetweenColumns(
        state.projectBoard.columns,
        action.payload.publicId,
        action.payload.to,
      );
    },
    rollbackBoardMove(
      state,
      action: PayloadAction<{ publicId: string; from: ProjectMilestone }>,
    ) {
      moveProjectBetweenColumns(
        state.projectBoard.columns,
        action.payload.publicId,
        action.payload.from,
      );
      state.projectBoard.movingId = null;
    },
    clearBoardMoving(state) {
      state.projectBoard.movingId = null;
    },
  },
  extraReducers: (builder) => {
    bindSingle(builder, "dashboard", fetchAdminDashboard);
    bindSingle(builder, "projectDetail", fetchAdminProject);
    bindSingle(builder, "eventDetail", fetchAdminEventDetail);
    bindSingle(builder, "clientDetail", fetchAdminClientDetail);
    bindSingle(builder, "affiliateDetail", fetchAdminAffiliateDetail);
    bindSingle(builder, "contractorDetail", fetchAdminContractorDetail);
    bindSingle(builder, "settings", fetchAdminSettings);
    bindList(builder, "leads", fetchAdminLeads);
    bindList(builder, "events", fetchAdminEvents);
    bindList(builder, "eventAttendees", fetchAdminEventAttendees);
    bindList(builder, "affiliates", fetchAdminAffiliates);
    bindList(builder, "contractors", fetchAdminContractors);
    bindList(builder, "clients", fetchAdminClients);
    bindList(builder, "projects", fetchAdminProjects);
    bindList(builder, "draws", fetchAdminDraws);
    bindList(builder, "commissions", fetchAdminCommissions);
    bindList(builder, "staff", fetchAdminStaff);
    bindList(builder, "assignees", fetchAdminAssignees);
    bindList(builder, "plans", fetchAdminPlans);

    builder
      .addCase(fetchAdminProjectBoard.pending, (state) => {
        state.projectBoard.loading = true;
        state.projectBoard.error = null;
      })
      .addCase(fetchAdminProjectBoard.fulfilled, (state, action) => {
        state.projectBoard.loading = false;
        const cols = { ...emptyBoardColumns() } as Record<
          ProjectMilestone,
          AdminProjectBoardColumn
        >;
        for (const m of BOARD_MILESTONES) {
          cols[m] = action.payload.columns[m] || emptyCol();
        }
        state.projectBoard.columns = cols;
      })
      .addCase(fetchAdminProjectBoard.rejected, (state, action) => {
        state.projectBoard.loading = false;
        state.projectBoard.error = action.payload || "errors.server";
      });

    builder
      .addCase(fetchMoreAdminProjectBoard.pending, (state, action) => {
        state.projectBoard.loadingMore = action.meta.arg.milestone;
      })
      .addCase(fetchMoreAdminProjectBoard.fulfilled, (state, action) => {
        state.projectBoard.loadingMore = null;
        const m = action.payload.milestone;
        const col = state.projectBoard.columns[m];
        const seen = new Set(col.items.map((p) => p.public_id));
        const extra = action.payload.items.filter((p) => !seen.has(p.public_id));
        col.items = [...col.items, ...extra];
        col.total = action.payload.total;
        col.offset = action.payload.offset;
        col.limit = action.payload.limit;
        col.has_more = action.payload.has_more;
      })
      .addCase(fetchMoreAdminProjectBoard.rejected, (state) => {
        state.projectBoard.loadingMore = null;
      });

    builder.addCase(updateAdminProject.fulfilled, (state, action) => {
      state.projectDetail.data = action.payload;
      state.projectBoard.movingId = null;
      const p = action.payload.project;
      let located: ProjectMilestone | null = null;
      for (const m of BOARD_MILESTONES) {
        const col = state.projectBoard.columns[m];
        const idx = col.items.findIndex((x) => x.public_id === p.public_id);
        if (idx >= 0) {
          located = m;
          if (m === p.milestone) {
            col.items[idx] = p;
          } else {
            col.items = [...col.items.slice(0, idx), ...col.items.slice(idx + 1)];
            col.total = Math.max(0, col.total - 1);
            col.has_more = col.items.length < col.total;
            const dest = state.projectBoard.columns[p.milestone];
            if (!dest.items.some((x) => x.public_id === p.public_id)) {
              dest.items = [p, ...dest.items];
              dest.total += 1;
              dest.has_more = dest.items.length < dest.total;
            } else {
              dest.items = dest.items.map((x) => (x.public_id === p.public_id ? p : x));
            }
          }
          break;
        }
      }
      if (!located) {
        const dest = state.projectBoard.columns[p.milestone];
        if (!dest.items.some((x) => x.public_id === p.public_id)) {
          dest.items = [p, ...dest.items];
          dest.total += 1;
        }
      }
    });
    builder.addCase(updateAdminEvent.fulfilled, (state, action) => {
      const ev = action.payload?.event;
      if (!ev) return;
      state.eventDetail.data = ev;
      state.events.items = state.events.items.map((x) => (x.id === ev.id ? ev : x));
    });
    builder.addCase(syncAdminProjectAnchor.fulfilled, (state, action) => {
      state.projectDetail.data = action.payload;
    });

    builder
      .addCase(fetchNotifyRecipients.pending, (state) => {
        state.notifyRecipients.loading = true;
        state.notifyRecipients.error = null;
      })
      .addCase(fetchNotifyRecipients.fulfilled, (state, action) => {
        // Ignore stale list fetches while a prefs save is in flight
        if (state.notifyRecipients.saving) {
          state.notifyRecipients.loading = false;
          return;
        }
        state.notifyRecipients.loading = false;
        state.notifyRecipients.staff = action.payload.staff;
        state.notifyRecipients.extras = action.payload.extras;
        state.notifyRecipients.events = action.payload.events;
      })
      .addCase(fetchNotifyRecipients.rejected, (state, action) => {
        state.notifyRecipients.loading = false;
        state.notifyRecipients.error =
          (action.payload as string | undefined) || "errors.server";
      })
      .addCase(updateStaffNotifyPrefs.pending, (state, action) => {
        state.notifyRecipients.saving = true;
        state.notifyRecipients.error = null;
        // Keep the first snapshot if another prefs write is already in flight
        // so concurrent toggles don't clobber rollback state.
        if (!state.notifyRecipients.staffPrefsSnapshot) {
          state.notifyRecipients.staffPrefsSnapshot =
            state.notifyRecipients.staff.map((row) => ({
              ...row,
              prefs: {
                email: { ...row.prefs.email },
                in_app: { ...row.prefs.in_app },
                sms: { ...row.prefs.sms },
              },
              channels: { ...row.channels },
            }));
        }
        const { id, patch } = action.meta.arg;
        state.notifyRecipients.staff = state.notifyRecipients.staff.map((row) =>
          row.id === id
            ? { ...row, prefs: applyAdminNotifyPrefsPatch(row.prefs, patch) }
            : row,
        );
      })
      .addCase(updateStaffNotifyPrefs.fulfilled, (state, action) => {
        state.notifyRecipients.saving = false;
        state.notifyRecipients.staffPrefsSnapshot = null;
        const staff = action.payload;
        if (!staff) return;
        state.notifyRecipients.staff = state.notifyRecipients.staff.map((row) =>
          row.id === staff.id ? staff : row,
        );
      })
      .addCase(updateStaffNotifyPrefs.rejected, (state, action) => {
        state.notifyRecipients.saving = false;
        state.notifyRecipients.error =
          (action.payload as string | undefined) || "errors.server";
        if (state.notifyRecipients.staffPrefsSnapshot) {
          state.notifyRecipients.staff = state.notifyRecipients.staffPrefsSnapshot;
          state.notifyRecipients.staffPrefsSnapshot = null;
        }
      });

    builder.addCase(updateNotifyExtra.fulfilled, (state, action) => {
      const id = action.meta.arg.id;
      const patch = action.meta.arg.patch || {};
      state.notifyRecipients.extras = state.notifyRecipients.extras.map((row) => {
        if (row.id !== id) return row;
        return {
          ...row,
          ...(typeof patch.is_active === "boolean"
            ? { is_active: patch.is_active }
            : {}),
          ...(patch.label !== undefined
            ? { label: (patch.label as string | null) ?? null }
            : {}),
          ...("events" in patch
            ? { events: (patch.events as AdminNotifyEventKey[] | null) ?? null }
            : {}),
        };
      });
      if (state.settings.data) {
        state.settings.data.notify_extra_emails =
          state.settings.data.notify_extra_emails.map((row) => {
            if (row.id !== id) return row;
            return {
              ...row,
              ...(typeof patch.is_active === "boolean"
                ? { is_active: patch.is_active }
                : {}),
              ...("events" in patch
                ? {
                    events:
                      (patch.events as AdminNotifyEventKey[] | null) ?? null,
                  }
                : {}),
            };
          });
      }
    });
    builder.addCase(deleteNotifyExtra.fulfilled, (state, action) => {
      const id = action.meta.arg;
      state.notifyRecipients.extras = state.notifyRecipients.extras.filter(
        (r) => r.id !== id,
      );
    });

    builder
      .addCase(convertAdminLead.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(convertAdminLead.fulfilled, (state) => {
        state.saving = false;
      })
      .addCase(convertAdminLead.rejected, (state, action) => {
        state.saving = false;
        state.saveError = action.payload?.error || "errors.server";
      });

    builder
      .addMatcher(isAnyOf(...mutations.map((m) => m.pending)), (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addMatcher(isAnyOf(...mutations.map((m) => m.fulfilled)), (state) => {
        state.saving = false;
      })
      .addMatcher(isAnyOf(...mutations.map((m) => m.rejected)), (state, action) => {
        state.saving = false;
        state.saveError = (action.payload as string | undefined) || "errors.server";
      });
  },
});

export const {
  clearAdminSaveError,
  clearAdminProject,
  clearAdminEvent,
  clearAdminRecordDetail,
  setProjectBoardFilters,
  optimisticBoardMove,
  rollbackBoardMove,
  clearBoardMoving,
} = adminPortalSlice.actions;
export default adminPortalSlice.reducer;
