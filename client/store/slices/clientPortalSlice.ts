import { createSlice } from "@reduxjs/toolkit";
import type { ClientDocument, ClientOverview } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type State = {
  overview: ClientOverview | null;
  documents: ClientDocument[];
  loading: boolean;
  error: string | null;
};

const initialState: State = {
  overview: null,
  documents: [],
  loading: false,
  error: null,
};

export const fetchClientOverview = createApiThunk("clientPortal/overview", "client", async () =>
  (await api.get<ClientOverview>("/client/overview")).data,
);
export const fetchClientDocuments = createApiThunk("clientPortal/documents", "client", async () =>
  (await api.get<{ documents: ClientDocument[] }>("/client/documents")).data.documents,
);

const slice = createSlice({
  name: "clientPortal",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchClientOverview.pending, (s) => {
        s.loading = true;
        s.error = null;
      })
      .addCase(fetchClientOverview.fulfilled, (s, a) => {
        s.loading = false;
        s.overview = a.payload;
      })
      .addCase(fetchClientOverview.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(fetchClientDocuments.pending, (s) => {
        s.loading = true;
        s.error = null;
      })
      .addCase(fetchClientDocuments.fulfilled, (s, a) => {
        s.loading = false;
        s.documents = a.payload;
      })
      .addCase(fetchClientDocuments.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      });
  },
});

export default slice.reducer;
