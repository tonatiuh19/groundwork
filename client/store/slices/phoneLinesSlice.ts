import { createSlice } from "@reduxjs/toolkit";
import type { AvailableTwilioNumber, PhoneLineMode, PhoneLineSettings, PhoneLineSettingsBody } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

export const fetchPhoneLine = createApiThunk<PhoneLineSettings, number>(
  "phoneLines/fetch",
  "admin",
  async (id) => (await api.get(`/admin/phone-lines/${id}`)).data,
);

export const savePhoneLine = createApiThunk<PhoneLineSettings, { id: number; body: PhoneLineSettingsBody }>(
  "phoneLines/save",
  "admin",
  async ({ id, body }) => (await api.put(`/admin/phone-lines/${id}`, body)).data,
);

export const fetchAvailableTwilioNumbers = createApiThunk<AvailableTwilioNumber[], void>(
  "phoneLines/available",
  "admin",
  async () => (await api.get<{ numbers: AvailableTwilioNumber[] }>("/admin/phone-lines/available")).data.numbers,
);

export const connectTwilioNumber = createApiThunk<
  PhoneLineSettings,
  { sid: string; line_mode: PhoneLineMode; assigned_admin_id: number | null; take_over?: boolean }
>("phoneLines/connect", "admin", async (body) => (await api.post("/admin/phone-lines/connect", body)).data);

export const disconnectPhoneLine = createApiThunk<{ ok: true }, { id: number; confirm: string }>(
  "phoneLines/disconnect",
  "admin",
  async ({ id, confirm }) => (await api.post(`/admin/phone-lines/${id}/disconnect`, { confirm })).data,
);

type State = { current: PhoneLineSettings | null; loading: boolean; saving: boolean; error: string | null };
const initialState: State = { current: null, loading: false, saving: false, error: null };

const slice = createSlice({
  name: "phoneLines",
  initialState,
  reducers: {
    clearPhoneLine: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(fetchPhoneLine.pending, (s) => {
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchPhoneLine.fulfilled, (s, a) => {
        s.loading = false;
        s.current = a.payload;
      })
      .addCase(fetchPhoneLine.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(savePhoneLine.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
      .addCase(savePhoneLine.fulfilled, (s, a) => {
        s.saving = false;
        s.current = a.payload;
      })
      .addCase(savePhoneLine.rejected, (s, a) => {
        s.saving = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(disconnectPhoneLine.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
      .addCase(disconnectPhoneLine.fulfilled, (s) => {
        s.saving = false;
      })
      .addCase(disconnectPhoneLine.rejected, (s, a) => {
        s.saving = false;
        s.error = a.payload || "errors.server";
      });
  },
});

export const { clearPhoneLine } = slice.actions;
export default slice.reducer;
