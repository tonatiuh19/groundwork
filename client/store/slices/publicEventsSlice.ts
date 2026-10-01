import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import type { PublicEventView } from "@shared/api";
import { api, formatAxiosError } from "@/lib/api";
import { logger } from "@/utils/logger";

export type EventLang = "en" | "es";

const failure = (error: unknown) =>
  axios.isAxiosError(error) && error.response?.status === 404
    ? "errors.eventNotFound"
    : formatAxiosError(error, "errors.server");

/** Featured/next published event for the homepage ribbon + RSVP form (null when none). */
export const fetchLiveEvent = createAsyncThunk<
  PublicEventView | null,
  EventLang,
  { rejectValue: string }
>("publicEvents/live", async (lang, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ ok: boolean; event: PublicEventView | null }>(
      "/public/events/live",
      { params: { lang } },
    );
    return data.event ?? null;
  } catch (error) {
    const message = failure(error);
    logger.error("publicEvents", message);
    return rejectWithValue(message);
  }
});

/** Single public event page (`/events/:slug`). 404 → `errors.eventNotFound`. */
export const fetchEventBySlug = createAsyncThunk<
  PublicEventView,
  { slug: string; lang: EventLang },
  { rejectValue: string }
>("publicEvents/bySlug", async ({ slug, lang }, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ ok: boolean; event: PublicEventView }>(
      `/public/events/${encodeURIComponent(slug)}`,
      { params: { lang } },
    );
    if (!data.event) return rejectWithValue("errors.eventNotFound");
    return data.event;
  } catch (error) {
    const message = failure(error);
    logger.error("publicEvents", message);
    return rejectWithValue(message);
  }
});

type PublicEventsState = {
  live: { event: PublicEventView | null; loading: boolean; loaded: boolean; error: string | null };
  detail: {
    slug: string | null;
    event: PublicEventView | null;
    loading: boolean;
    error: string | null;
  };
};

const initialState: PublicEventsState = {
  live: { event: null, loading: false, loaded: false, error: null },
  detail: { slug: null, event: null, loading: false, error: null },
};

const publicEventsSlice = createSlice({
  name: "publicEvents",
  initialState,
  reducers: {
    clearEventDetail(state) {
      state.detail = initialState.detail;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchLiveEvent.pending, (state) => {
        state.live.loading = true;
        state.live.error = null;
      })
      .addCase(fetchLiveEvent.fulfilled, (state, action) => {
        state.live.loading = false;
        state.live.loaded = true;
        state.live.event = action.payload;
      })
      .addCase(fetchLiveEvent.rejected, (state, action) => {
        // A failed lookup must never block the homepage: fall back to standard mode.
        state.live.loading = false;
        state.live.loaded = true;
        state.live.event = null;
        state.live.error = action.payload || "errors.server";
      });

    builder
      .addCase(fetchEventBySlug.pending, (state, action) => {
        state.detail.loading = true;
        state.detail.error = null;
        if (state.detail.slug !== action.meta.arg.slug) state.detail.event = null;
        state.detail.slug = action.meta.arg.slug;
      })
      .addCase(fetchEventBySlug.fulfilled, (state, action) => {
        if (state.detail.slug !== action.meta.arg.slug) return;
        state.detail.loading = false;
        state.detail.event = action.payload;
      })
      .addCase(fetchEventBySlug.rejected, (state, action) => {
        if (state.detail.slug !== action.meta.arg.slug) return;
        state.detail.loading = false;
        state.detail.event = null;
        state.detail.error = action.payload || "errors.server";
      });
  },
});

export const { clearEventDetail } = publicEventsSlice.actions;
export default publicEventsSlice.reducer;
