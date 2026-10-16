import { createSlice } from "@reduxjs/toolkit";
import type { ErasePreview, LeadTouch, RecordSearchResults } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Staff record search (pickers) + erase-a-person (preview, delete). */

export const searchRecords = createApiThunk<RecordSearchResults, string>(
  "records/search",
  "admin",
  async (q) => (await api.get("/admin/search/records", { params: { q } })).data,
);

export const fetchErasePreview = createApiThunk<ErasePreview, { entity: ErasePreview["person"]["entity"]; id: number }>(
  "records/erasePreview",
  "admin",
  async ({ entity, id }) => (await api.get(`/admin/people/${entity}/${id}/erase-preview`)).data,
);

export const erasePerson = createApiThunk<{ ok: true }, { entity: ErasePreview["person"]["entity"]; id: number; reason: string }>(
  "records/erase",
  "admin",
  async ({ entity, id, reason }) => (await api.delete(`/admin/people/${entity}/${id}`, { data: { confirm: true, reason } })).data,
);

/** Record pages: latest text / call with one phone number. */
export const fetchLastTouch = createApiThunk<{ last_sms: LeadTouch | null; last_call: LeadTouch | null }, string>(
  "records/lastTouch",
  "admin",
  async (phone) => (await api.get("/admin/last-touch", { params: { phone } })).data,
);

type State = {
  /** Keyed by the phone the record page asked about. */
  touches: Record<string, { last_sms: LeadTouch | null; last_call: LeadTouch | null }>;
  query: string;
  results: RecordSearchResults | null;
  searching: boolean;
  preview: ErasePreview | null;
  previewLoading: boolean;
  erasing: boolean;
  eraseError: string | null;
};
const initialState: State = { touches: {}, query: "", results: null, searching: false, preview: null, previewLoading: false, erasing: false, eraseError: null };

const slice = createSlice({
  name: "records",
  initialState,
  reducers: {
    clearRecordSearch(s) {
      s.query = "";
      s.results = null;
    },
    clearErase(s) {
      s.preview = null;
      s.eraseError = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchLastTouch.fulfilled, (s, a) => {
      s.touches[a.meta.arg] = a.payload;
    });
    b.addCase(searchRecords.pending, (s, a) => {
      s.query = a.meta.arg;
      s.searching = true;
    })
      .addCase(searchRecords.fulfilled, (s, a) => {
        // Only the latest query wins (typing fast fires several).
        if (a.meta.arg !== s.query) return;
        s.searching = false;
        s.results = a.payload;
      })
      .addCase(searchRecords.rejected, (s, a) => {
        if (a.meta.arg === s.query) s.searching = false;
      })
      .addCase(fetchErasePreview.pending, (s) => {
        s.previewLoading = true;
        s.preview = null;
        s.eraseError = null;
      })
      .addCase(fetchErasePreview.fulfilled, (s, a) => {
        s.previewLoading = false;
        s.preview = a.payload;
      })
      .addCase(fetchErasePreview.rejected, (s, a) => {
        s.previewLoading = false;
        s.eraseError = a.payload || "errors.server";
      })
      .addCase(erasePerson.pending, (s) => {
        s.erasing = true;
        s.eraseError = null;
      })
      .addCase(erasePerson.fulfilled, (s) => {
        s.erasing = false;
      })
      .addCase(erasePerson.rejected, (s, a) => {
        s.erasing = false;
        s.eraseError = a.payload || "errors.server";
      });
  },
});

export const { clearRecordSearch, clearErase } = slice.actions;
export default slice.reducer;

