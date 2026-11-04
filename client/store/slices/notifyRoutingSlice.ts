import { createSlice } from "@reduxjs/toolkit";
import type { NotifyRouting, NotifyRoutingSaveBody } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Settings → Team notifications: who gets each notification area. */

export const fetchNotifyRouting = createApiThunk<NotifyRouting, void>(
  "notifyRouting/fetch",
  "admin",
  async () => (await api.get("/admin/notify-routing")).data,
);

export const saveNotifyRouting = createApiThunk<NotifyRouting, NotifyRoutingSaveBody>(
  "notifyRouting/save",
  "admin",
  async (body) => (await api.put("/admin/notify-routing", body)).data,
);

type State = { data: NotifyRouting | null; loading: boolean; saving: string | null; error: string | null };
const initialState: State = { data: null, loading: false, saving: null, error: null };

const slice = createSlice({
  name: "notifyRouting",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchNotifyRouting.pending, (s) => {
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchNotifyRouting.fulfilled, (s, a) => {
        s.loading = false;
        s.data = a.payload;
      })
      .addCase(fetchNotifyRouting.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(saveNotifyRouting.pending, (s, a) => {
        s.saving = a.meta.arg.areas[0]?.area ?? "all";
        s.error = null;
      })
      .addCase(saveNotifyRouting.fulfilled, (s, a) => {
        s.saving = null;
        s.data = a.payload;
      })
      .addCase(saveNotifyRouting.rejected, (s, a) => {
        s.saving = null;
        s.error = a.payload || "errors.server";
      });
  },
});

export default slice.reducer;
