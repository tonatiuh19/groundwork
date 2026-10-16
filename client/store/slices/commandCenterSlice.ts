import { createSlice } from "@reduxjs/toolkit";
import type { CommandCenter } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Staff dashboard data (role-aware). `mine` narrows to items assigned to the signed-in staff member. */
export const fetchCommandCenter = createApiThunk<CommandCenter, { mine: boolean }>(
  "commandCenter/fetch",
  "admin",
  async ({ mine }) => (await api.get("/admin/command-center", { params: mine ? { mine: "1" } : {} })).data,
);

type State = { data: CommandCenter | null; loading: boolean; error: string | null };
const initialState: State = { data: null, loading: false, error: null };

const slice = createSlice({
  name: "commandCenter",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchCommandCenter.pending, (s) => {
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchCommandCenter.fulfilled, (s, a) => {
        s.loading = false;
        s.data = a.payload;
      })
      .addCase(fetchCommandCenter.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      });
  },
});

export default slice.reducer;
