import { createSlice } from "@reduxjs/toolkit";
import type { ClientUpdate, DealStatus, DealStatusTone } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type UpdatesResponse = { updates: ClientUpdate[]; affiliate?: { id: number; first_name: string } | null };

export const fetchDealStatuses = createApiThunk<DealStatus[], void>(
  "dealStatus/list",
  "admin",
  async () => (await api.get<{ statuses: DealStatus[] }>("/admin/deal-statuses")).data.statuses,
);

export const createDealStatus = createApiThunk<
  DealStatus[],
  { label_en: string; label_es: string; tone: DealStatusTone; sort_order?: number }
>("dealStatus/create", "admin", async (body) => (await api.post<{ statuses: DealStatus[] }>("/admin/deal-statuses", body)).data.statuses);

export const updateDealStatus = createApiThunk<
  DealStatus[],
  { id: number; patch: Partial<Omit<DealStatus, "id">> }
>("dealStatus/update", "admin", async ({ id, patch }) =>
  (await api.patch<{ statuses: DealStatus[] }>(`/admin/deal-statuses/${id}`, patch)).data.statuses,
);

export const fetchClientUpdates = createApiThunk<UpdatesResponse, number>(
  "dealStatus/updates",
  "admin",
  async (clientId) => (await api.get<UpdatesResponse>(`/admin/clients/${clientId}/updates`)).data,
);

export const addClientUpdate = createApiThunk<
  UpdatesResponse,
  { clientId: number; body: string; share_with_affiliate: boolean }
>("dealStatus/addUpdate", "admin", async ({ clientId, ...body }) =>
  (await api.post<UpdatesResponse>(`/admin/clients/${clientId}/updates`, body)).data,
);

export const setClientDealStatus = createApiThunk<
  UpdatesResponse,
  { clientId: number; deal_status_id: number | null; note?: string; notify_affiliate: boolean }
>("dealStatus/setForClient", "admin", async ({ clientId, ...body }) =>
  (await api.patch<UpdatesResponse>(`/admin/clients/${clientId}/deal-status`, body)).data,
);

type State = {
  statuses: DealStatus[];
  statusesLoaded: boolean;
  updates: ClientUpdate[];
  updatesFor: number | null;
  affiliate: { id: number; first_name: string } | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

const initialState: State = {
  statuses: [],
  statusesLoaded: false,
  updates: [],
  updatesFor: null,
  affiliate: null,
  loading: false,
  saving: false,
  error: null,
};

const slice = createSlice({
  name: "dealStatus",
  initialState,
  reducers: {
    clearDealStatusError(s) {
      s.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchDealStatuses.fulfilled, (s, a) => {
      s.statuses = a.payload;
      s.statusesLoaded = true;
    });
    for (const t of [createDealStatus, updateDealStatus]) {
      b.addCase(t.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
        .addCase(t.fulfilled, (s, a) => {
          s.saving = false;
          s.statuses = a.payload;
        })
        .addCase(t.rejected, (s, a) => {
          s.saving = false;
          s.error = a.payload || "errors.server";
        });
    }
    b.addCase(fetchClientUpdates.pending, (s, a) => {
      s.loading = true;
      s.error = null;
      if (s.updatesFor !== a.meta.arg) s.updates = [];
      s.updatesFor = a.meta.arg;
    })
      .addCase(fetchClientUpdates.fulfilled, (s, a) => {
        if (s.updatesFor !== a.meta.arg) return;
        s.loading = false;
        s.updates = a.payload.updates;
        s.affiliate = a.payload.affiliate ?? null;
      })
      .addCase(fetchClientUpdates.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      });
    for (const t of [addClientUpdate, setClientDealStatus]) {
      b.addCase(t.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
        .addCase(t.fulfilled, (s, a) => {
          s.saving = false;
          if (s.updatesFor === a.meta.arg.clientId) s.updates = a.payload.updates;
        })
        .addCase(t.rejected, (s, a) => {
          s.saving = false;
          s.error = a.payload || "errors.server";
        });
    }
  },
});

export const { clearDealStatusError } = slice.actions;
export default slice.reducer;
