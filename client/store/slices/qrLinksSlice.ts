import { createSlice } from "@reduxjs/toolkit";
import type { QrDestinationOption, QrDestinationType, QrEventCode, QrExternalLink, QrLink, QrLinkInput, QrLinkInsights } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Admin -> QR codes: printed /go/{slug} codes, event codes, approved external links. */
export const fetchQrLinks = createApiThunk<{ items: QrLink[]; event_codes: QrEventCode[] }, void>("qrLinks/list", "admin", async () => (await api.get("/admin/qr-links")).data);
export const createQrLink = createApiThunk<{ item: QrLink }, QrLinkInput>(
  "qrLinks/create",
  "admin",
  async (body) => (await api.post("/admin/qr-links", body)).data,
);
export const updateQrLink = createApiThunk<{ item: QrLink }, { id: number; body: QrLinkInput }>(
  "qrLinks/update",
  "admin",
  async ({ id, body }) => (await api.patch(`/admin/qr-links/${id}`, body)).data,
);
export const fetchQrDestinations = createApiThunk<{ options: QrDestinationOption[] }, { type: QrDestinationType; q?: string }>(
  "qrLinks/destinations",
  "admin",
  async (params) => (await api.get("/admin/qr-destinations", { params })).data,
);
export const fetchQrInsights = createApiThunk<QrLinkInsights, number>("qrLinks/insights", "admin", async (id) => (await api.get(`/admin/qr-links/${id}/insights`)).data);
export const fetchQrExternalLinks = createApiThunk<{ items: QrExternalLink[] }, void>("qrLinks/externalList", "admin", async () => (await api.get("/admin/qr-external-links")).data);
export const createQrExternalLink = createApiThunk<{ item: QrExternalLink }, { label: string; url: string }>(
  "qrLinks/externalCreate",
  "admin",
  async (body) => (await api.post("/admin/qr-external-links", body)).data,
);
export const updateQrExternalLink = createApiThunk<{ item: QrExternalLink }, { id: number; body: Partial<Omit<QrExternalLink, "id">> }>(
  "qrLinks/externalUpdate",
  "admin",
  async ({ id, body }) => (await api.patch(`/admin/qr-external-links/${id}`, body)).data,
);

type State = {
  items: QrLink[];
  eventCodes: QrEventCode[];
  externals: QrExternalLink[];
  options: QrDestinationOption[];
  optionsLoading: boolean;
  insights: QrLinkInsights | null;
  insightsLoading: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
};
const initialState: State = { items: [], eventCodes: [], externals: [], options: [], optionsLoading: false, insights: null, insightsLoading: false, loading: false, saving: false, error: null };

const upsert = (s: State, item: QrLink) => {
  const i = s.items.findIndex((x) => x.id === item.id);
  if (i >= 0) s.items[i] = item;
  else s.items.unshift(item);
};
const upsertExternal = (s: State, item: QrExternalLink) => {
  const i = s.externals.findIndex((x) => x.id === item.id);
  if (i >= 0) s.externals[i] = item;
  else s.externals.unshift(item);
};

const slice = createSlice({
  name: "qrLinks",
  initialState,
  reducers: {
    clearQrError(s) {
      s.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchQrLinks.pending, (s) => {
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchQrLinks.fulfilled, (s, a) => {
        s.loading = false;
        s.items = a.payload.items;
        s.eventCodes = a.payload.event_codes;
      })
      .addCase(fetchQrLinks.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(fetchQrDestinations.pending, (s) => {
        s.optionsLoading = true;
      })
      .addCase(fetchQrDestinations.fulfilled, (s, a) => {
        s.optionsLoading = false;
        s.options = a.payload.options;
      })
      .addCase(fetchQrDestinations.rejected, (s) => {
        s.optionsLoading = false;
        s.options = [];
      })
      .addCase(fetchQrInsights.pending, (s) => {
        s.insightsLoading = true;
        s.insights = null;
      })
      .addCase(fetchQrInsights.fulfilled, (s, a) => {
        s.insightsLoading = false;
        s.insights = a.payload;
      })
      .addCase(fetchQrInsights.rejected, (s, a) => {
        s.insightsLoading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(fetchQrExternalLinks.fulfilled, (s, a) => {
        s.externals = a.payload.items;
      });
    for (const th of [createQrLink, updateQrLink] as const) {
      b.addCase(th.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
        .addCase(th.fulfilled, (s, a) => {
          s.saving = false;
          upsert(s, a.payload.item);
        })
        .addCase(th.rejected, (s, a) => {
          s.saving = false;
          s.error = a.payload || "errors.server";
        });
    }
    for (const th of [createQrExternalLink, updateQrExternalLink] as const) {
      b.addCase(th.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
        .addCase(th.fulfilled, (s, a) => {
          s.saving = false;
          upsertExternal(s, a.payload.item);
        })
        .addCase(th.rejected, (s, a) => {
          s.saving = false;
          s.error = a.payload || "errors.server";
        });
    }
  },
});

export const { clearQrError } = slice.actions;
export default slice.reducer;
