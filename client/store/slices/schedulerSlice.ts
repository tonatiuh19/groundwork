import { createSlice } from "@reduxjs/toolkit";
import type {
  AffiliateAppointment,
  Appointment,
  AppointmentBody,
  AppointmentConflict,
  Lender,
  LenderBody,
  SchedulerResponse,
  SchedulerSettings,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Scheduler: staff calendar + appointments, lenders directory, my booking link, portal views. */

export type AppointmentQuery = {
  from: string;
  to: string;
  client_id?: number;
  project_id?: number;
  lead_id?: number;
  admin_id?: number;
  include_cancelled?: boolean;
};

const qs = (q: AppointmentQuery) => ({
  ...q,
  include_cancelled: q.include_cancelled ? "1" : undefined,
});

/** Calendar range (the page) — kept separate from record panels. */
export const fetchCalendar = createApiThunk<{ appointments: Appointment[] }, AppointmentQuery>(
  "scheduler/calendar",
  "admin",
  async (q) => (await api.get("/admin/appointments", { params: qs(q) })).data,
);

/** Appointments for one record (client / project page panel). */
export const fetchRecordAppointments = createApiThunk<{ appointments: Appointment[] }, AppointmentQuery & { key: string }>(
  "scheduler/record",
  "admin",
  async ({ key: _key, ...q }) => (await api.get("/admin/appointments", { params: qs(q) })).data,
);

export const fetchAppointmentById = createApiThunk<{ appointment: Appointment }, number>(
  "scheduler/one",
  "admin",
  async (id) => (await api.get(`/admin/appointments/${id}`)).data,
);

export const saveAppointment = createApiThunk<
  { appointment: Appointment; conflicts: AppointmentConflict[] },
  { id: number | null; body: Partial<AppointmentBody> }
>("scheduler/save", "admin", async ({ id, body }) =>
  (id ? await api.patch(`/admin/appointments/${id}`, body) : await api.post("/admin/appointments", body)).data,
);

export const cancelAppointment = createApiThunk<{ ok: true }, { id: number; reason?: string }>(
  "scheduler/cancel",
  "admin",
  async ({ id, reason }) => (await api.post(`/admin/appointments/${id}/cancel`, { reason: reason || null })).data,
);

export const setAppointmentStatus = createApiThunk<{ ok: true }, { id: number; status: "completed" | "no_show" | "scheduled" }>(
  "scheduler/status",
  "admin",
  async ({ id, status }) => (await api.post(`/admin/appointments/${id}/status`, { status })).data,
);

export const fetchLenders = createApiThunk<{ lenders: Lender[] }, void>(
  "scheduler/lenders",
  "admin",
  async () => (await api.get("/admin/lenders")).data,
);

export const saveLender = createApiThunk<{ lenders: Lender[] }, { id: number | null; body: LenderBody }>(
  "scheduler/saveLender",
  "admin",
  async ({ id, body }) => (id ? await api.put(`/admin/lenders/${id}`, body) : await api.post("/admin/lenders", body)).data,
);

export const fetchMyScheduler = createApiThunk<SchedulerResponse, void>(
  "scheduler/mine",
  "admin",
  async () => (await api.get("/admin/scheduler")).data,
);

export const saveMyScheduler = createApiThunk<SchedulerResponse, Partial<SchedulerSettings>>(
  "scheduler/saveMine",
  "admin",
  async (body) => (await api.put("/admin/scheduler", body)).data,
);

export const addBlockedRange = createApiThunk<{ ok: true }, { from_date: string; to_date?: string; label?: string }>(
  "scheduler/block",
  "admin",
  async (body) => (await api.post("/admin/scheduler/blocked", body)).data,
);

export const removeBlockedRange = createApiThunk<{ ok: true }, number>(
  "scheduler/unblock",
  "admin",
  async (id) => (await api.delete(`/admin/scheduler/blocked/${id}`)).data,
);

export const fetchContractorAppointments = createApiThunk<{ appointments: Appointment[] }, void>(
  "scheduler/contractor",
  "contractor",
  async () => (await api.get("/contractor/appointments")).data,
);

export const fetchAffiliateAppointments = createApiThunk<{ appointments: AffiliateAppointment[] }, void>(
  "scheduler/affiliate",
  "affiliate",
  async () => (await api.get("/affiliate/appointments")).data,
);

type State = {
  calendar: Appointment[];
  calendarLoading: boolean;
  calendarError: string | null;
  /** Panel lists keyed by record (e.g. `client:12`). */
  byRecord: Record<string, Appointment[]>;
  saving: boolean;
  saveError: string | null;
  conflicts: AppointmentConflict[];
  lenders: Lender[];
  lendersSaving: boolean;
  lendersError: string | null;
  mine: SchedulerResponse | null;
  mineSaving: boolean;
  mineError: string | null;
  portal: Appointment[];
  affiliate: AffiliateAppointment[];
  portalLoading: boolean;
};

const initialState: State = {
  calendar: [],
  calendarLoading: false,
  calendarError: null,
  byRecord: {},
  saving: false,
  saveError: null,
  conflicts: [],
  lenders: [],
  lendersSaving: false,
  lendersError: null,
  mine: null,
  mineSaving: false,
  mineError: null,
  portal: [],
  affiliate: [],
  portalLoading: false,
};

const slice = createSlice({
  name: "scheduler",
  initialState,
  reducers: {
    clearSchedulerErrors(s) {
      s.saveError = null;
      s.conflicts = [];
      s.lendersError = null;
      s.mineError = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchCalendar.pending, (s) => {
      s.calendarLoading = true;
      s.calendarError = null;
    })
      .addCase(fetchCalendar.fulfilled, (s, a) => {
        s.calendarLoading = false;
        s.calendar = a.payload.appointments;
      })
      .addCase(fetchCalendar.rejected, (s, a) => {
        s.calendarLoading = false;
        s.calendarError = a.payload || "errors.server";
      })
      .addCase(fetchRecordAppointments.fulfilled, (s, a) => {
        s.byRecord[a.meta.arg.key] = a.payload.appointments;
      });
    for (const t of [saveAppointment, cancelAppointment, setAppointmentStatus]) {
      b.addCase(t.pending, (s) => {
        s.saving = true;
        s.saveError = null;
      }).addCase(t.rejected, (s, a) => {
        s.saving = false;
        s.saveError = a.payload || "errors.server";
      });
    }
    b.addCase(saveAppointment.fulfilled, (s, a) => {
      s.saving = false;
      s.conflicts = a.payload.conflicts || [];
    });
    for (const t of [cancelAppointment, setAppointmentStatus]) {
      b.addCase(t.fulfilled, (s) => {
        s.saving = false;
      });
    }
    b.addCase(fetchLenders.fulfilled, (s, a) => {
      s.lenders = a.payload.lenders;
    })
      .addCase(saveLender.pending, (s) => {
        s.lendersSaving = true;
        s.lendersError = null;
      })
      .addCase(saveLender.fulfilled, (s, a) => {
        s.lendersSaving = false;
        s.lenders = a.payload.lenders;
      })
      .addCase(saveLender.rejected, (s, a) => {
        s.lendersSaving = false;
        s.lendersError = a.payload || "errors.server";
      })
      .addCase(fetchMyScheduler.fulfilled, (s, a) => {
        s.mine = a.payload;
      })
      .addCase(saveMyScheduler.pending, (s) => {
        s.mineSaving = true;
        s.mineError = null;
      })
      .addCase(saveMyScheduler.fulfilled, (s, a) => {
        s.mineSaving = false;
        s.mine = { ...a.payload, blocked: s.mine?.blocked ?? [] };
      })
      .addCase(saveMyScheduler.rejected, (s, a) => {
        s.mineSaving = false;
        s.mineError = a.payload || "errors.server";
      })
      .addCase(fetchContractorAppointments.pending, (s) => {
        s.portalLoading = true;
      })
      .addCase(fetchContractorAppointments.fulfilled, (s, a) => {
        s.portalLoading = false;
        s.portal = a.payload.appointments;
      })
      .addCase(fetchContractorAppointments.rejected, (s) => {
        s.portalLoading = false;
      })
      .addCase(fetchAffiliateAppointments.fulfilled, (s, a) => {
        s.affiliate = a.payload.appointments;
      });
  },
});

export const { clearSchedulerErrors } = slice.actions;
export default slice.reducer;
