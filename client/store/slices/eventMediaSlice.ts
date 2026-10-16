import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import { put as putBlob } from "@vercel/blob/client";
import type { AdminEventMedia } from "@shared/api";
import { api, formatAxiosError } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type MediaResponse = { ok: true; media: AdminEventMedia[] };
type Captions = { caption_en?: string | null; caption_es?: string | null };

export const fetchEventMedia = createApiThunk<AdminEventMedia[], number>(
  "eventMedia/fetch",
  "admin",
  async (eventId) => (await api.get<MediaResponse>(`/admin/events/${eventId}/media`)).data.media,
);

/**
 * Direct browser → public Blob upload (videos can exceed the 4.5MB function cap):
 * 1) API mints a pathname-scoped token, 2) upload, 3) API sniffs bytes + registers.
 */
export const uploadEventMedia = createAsyncThunk<
  AdminEventMedia[],
  { eventId: number; file: File; uploadId: string } & Captions,
  { rejectValue: string }
>("eventMedia/upload", async ({ eventId, file, uploadId, ...captions }, { dispatch, rejectWithValue }) => {
  try {
    const grant = (
      await api.post<{ client_token: string; pathname: string }>(`/admin/events/${eventId}/media/upload-token`, {
        content_type: file.type,
        size_bytes: file.size,
      })
    ).data;
    await putBlob(grant.pathname, file, {
      access: "public",
      token: grant.client_token,
      contentType: file.type,
      multipart: file.size > 8 * 1024 * 1024,
      onUploadProgress: ({ percentage }) =>
        dispatch(eventMediaSlice.actions.uploadProgress({ uploadId, progress: Math.round(percentage) })),
    });
    return (
      await api.post<MediaResponse>(`/admin/events/${eventId}/media`, { pathname: grant.pathname, ...captions })
    ).data.media;
  } catch (error) {
    if (axios.isAxiosError(error)) return rejectWithValue(formatAxiosError(error, "errors.uploadFailed"));
    return rejectWithValue("errors.uploadFailed");
  }
});

export const addEventEmbed = createApiThunk<AdminEventMedia[], { eventId: number; embed_url: string } & Captions>(
  "eventMedia/embed",
  "admin",
  async ({ eventId, ...body }) => (await api.post<MediaResponse>(`/admin/events/${eventId}/media`, body)).data.media,
);

export const updateEventMedia = createApiThunk<
  AdminEventMedia[],
  { eventId: number; id: number; patch: Captions & { is_cover?: boolean; is_highlight?: boolean } }
>(
  "eventMedia/update",
  "admin",
  async ({ eventId, id, patch }) =>
    (await api.patch<MediaResponse>(`/admin/events/${eventId}/media/${id}`, patch)).data.media,
);

export const reorderEventMedia = createApiThunk<AdminEventMedia[], { eventId: number; ids: number[] }>(
  "eventMedia/reorder",
  "admin",
  async ({ eventId, ids }) =>
    (await api.post<MediaResponse>(`/admin/events/${eventId}/media/reorder`, { ids })).data.media,
);

export const deleteEventMedia = createApiThunk<AdminEventMedia[], { eventId: number; id: number }>(
  "eventMedia/delete",
  "admin",
  async ({ eventId, id }) => (await api.delete<MediaResponse>(`/admin/events/${eventId}/media/${id}`)).data.media,
);

type State = {
  items: AdminEventMedia[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** In-flight uploads by client id → percent. */
  uploads: Record<string, number>;
};

const initialState: State = { items: [], loading: false, saving: false, error: null, uploads: {} };

const eventMediaSlice = createSlice({
  name: "eventMedia",
  initialState,
  reducers: {
    uploadProgress(s, a: { payload: { uploadId: string; progress: number } }) {
      s.uploads[a.payload.uploadId] = a.payload.progress;
    },
    clearEventMedia() {
      return initialState;
    },
    clearEventMediaError(s) {
      s.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchEventMedia.pending, (s) => {
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchEventMedia.fulfilled, (s, a) => {
        s.loading = false;
        s.items = a.payload;
      })
      .addCase(fetchEventMedia.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      });
    b.addCase(uploadEventMedia.pending, (s, a) => {
      s.uploads[a.meta.arg.uploadId] = 0;
      s.error = null;
    })
      .addCase(uploadEventMedia.fulfilled, (s, a) => {
        delete s.uploads[a.meta.arg.uploadId];
        s.items = a.payload;
      })
      .addCase(uploadEventMedia.rejected, (s, a) => {
        delete s.uploads[a.meta.arg.uploadId];
        s.error = a.payload || "errors.uploadFailed";
      });
    for (const t of [addEventEmbed, updateEventMedia, reorderEventMedia, deleteEventMedia]) {
      b.addCase(t.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
        .addCase(t.fulfilled, (s, a) => {
          s.saving = false;
          s.items = a.payload;
        })
        .addCase(t.rejected, (s, a) => {
          s.saving = false;
          s.error = a.payload || "errors.server";
        });
    }
  },
});

export const { clearEventMedia, clearEventMediaError } = eventMediaSlice.actions;
export default eventMediaSlice.reducer;
