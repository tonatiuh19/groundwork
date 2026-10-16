import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import type { ClientRevertBlocker, ClientRevertPlan, ClientRevertResponse, LeadStatus } from "@shared/api";
import { api, formatAxiosError } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** "Move back to Leads" — undo a client conversion (super_admin + admin). */
type State = {
  clientId: number | null;
  plan: ClientRevertPlan | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  actionError: string | null;
  actionBlockers: ClientRevertBlocker[];
  result: ClientRevertResponse["result"];
};

const initialState: State = {
  clientId: null,
  plan: null,
  loading: false,
  error: null,
  busy: false,
  actionError: null,
  actionBlockers: [],
  result: null,
};

/** Dry run: where the person goes back to, what moves, and what blocks. */
export const fetchClientRevertPreview = createApiThunk<ClientRevertResponse, number>(
  "clientRevert/preview",
  "admin",
  async (id) => (await api.get(`/admin/clients/${id}/revert-preview`)).data,
);

type Reject = { error: string; blockers?: ClientRevertBlocker[] };

export const revertClientToLead = createAsyncThunk<
  ClientRevertResponse,
  { id: number; lead_status?: Exclude<LeadStatus, "spam"> | null; reason?: string },
  { rejectValue: Reject }
>("clientRevert/run", async (a, { rejectWithValue }) => {
  try {
    return (
      await api.post(`/admin/clients/${a.id}/revert-to-lead`, {
        lead_status: a.lead_status || null,
        reason: a.reason?.trim() || null,
      })
    ).data;
  } catch (error) {
    const data = axios.isAxiosError(error) ? (error.response?.data as Reject | undefined) : undefined;
    return rejectWithValue({
      error: data?.error || formatAxiosError(error, "errors.server"),
      blockers: data?.blockers,
    });
  }
});

const clientRevertSlice = createSlice({
  name: "clientRevert",
  initialState,
  reducers: {
    resetClientRevert: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(fetchClientRevertPreview.pending, (s, a) => {
      s.clientId = a.meta.arg;
      s.loading = true;
      s.error = null;
      s.plan = null;
      s.actionError = null;
      s.actionBlockers = [];
      s.result = null;
    });
    b.addCase(fetchClientRevertPreview.fulfilled, (s, a) => {
      if (s.clientId !== a.meta.arg) return;
      s.loading = false;
      s.plan = a.payload.plan;
    });
    b.addCase(fetchClientRevertPreview.rejected, (s, a) => {
      if (s.clientId !== a.meta.arg) return;
      s.loading = false;
      s.error = (a.payload as string | undefined) || "errors.server";
    });
    b.addCase(revertClientToLead.pending, (s) => {
      s.busy = true;
      s.actionError = null;
      s.actionBlockers = [];
    });
    b.addCase(revertClientToLead.fulfilled, (s, a) => {
      s.busy = false;
      s.plan = a.payload.plan;
      s.result = a.payload.result;
    });
    b.addCase(revertClientToLead.rejected, (s, a) => {
      s.busy = false;
      s.actionError = a.payload?.error || "errors.server";
      s.actionBlockers = a.payload?.blockers || [];
    });
  },
});

export const { resetClientRevert } = clientRevertSlice.actions;
export default clientRevertSlice.reducer;
