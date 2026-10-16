import { createSlice } from "@reduxjs/toolkit";
import type { PublicAppointmentView, PublicBookingInfo } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Public booking page (/book/:slug) and "manage my appointment" (/appointment/:token). */

export const fetchBookingInfo = createApiThunk<PublicBookingInfo, { slug: string; lang: "en" | "es" }>(
  "booking/info",
  null,
  async ({ slug, lang }) => (await api.get(`/public/book/${encodeURIComponent(slug)}`, { params: { lang } })).data,
);

export const fetchBookingSlots = createApiThunk<{ date: string; slots: string[] }, { slug: string; date: string }>(
  "booking/slots",
  null,
  async ({ slug, date }) => (await api.get(`/public/book/${encodeURIComponent(slug)}/slots`, { params: { date } })).data,
);

export type BookingForm = {
  date: string;
  time: string;
  name: string;
  email: string;
  phone: string;
  location_type: string;
  address?: string;
  notes?: string;
  lang: "en" | "es";
};

export const submitBooking = createApiThunk<{ appointment_id: number }, { slug: string; body: BookingForm }>(
  "booking/submit",
  null,
  async ({ slug, body }) => (await api.post(`/public/book/${encodeURIComponent(slug)}`, body)).data,
);

export const fetchManagedAppointment = createApiThunk<PublicAppointmentView, string>(
  "booking/manage",
  null,
  async (token) => (await api.get(`/public/appointments/${encodeURIComponent(token)}`)).data,
);

export const cancelManagedAppointment = createApiThunk<{ ok: true }, { token: string; reason?: string }>(
  "booking/cancel",
  null,
  async ({ token, reason }) => (await api.post(`/public/appointments/${encodeURIComponent(token)}/cancel`, { reason })).data,
);

export const rescheduleManagedAppointment = createApiThunk<{ ok: true }, { token: string; date: string; time: string }>(
  "booking/reschedule",
  null,
  async ({ token, date, time }) => (await api.post(`/public/appointments/${encodeURIComponent(token)}/reschedule`, { date, time })).data,
);

type State = {
  info: PublicBookingInfo | null;
  infoError: string | null;
  slots: Record<string, string[]>;
  slotsLoading: boolean;
  submitting: boolean;
  submitError: string | null;
  booked: boolean;
  manage: PublicAppointmentView | null;
  manageError: string | null;
  manageBusy: boolean;
};

const initialState: State = {
  info: null,
  infoError: null,
  slots: {},
  slotsLoading: false,
  submitting: false,
  submitError: null,
  booked: false,
  manage: null,
  manageError: null,
  manageBusy: false,
};

const slice = createSlice({
  name: "booking",
  initialState,
  reducers: {
    resetBooking: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(fetchBookingInfo.fulfilled, (s, a) => {
      s.info = a.payload;
      s.infoError = null;
    })
      .addCase(fetchBookingInfo.rejected, (s, a) => {
        s.infoError = a.payload || "errors.notFound";
      })
      .addCase(fetchBookingSlots.pending, (s) => {
        s.slotsLoading = true;
      })
      .addCase(fetchBookingSlots.fulfilled, (s, a) => {
        s.slotsLoading = false;
        s.slots[a.payload.date] = a.payload.slots;
      })
      .addCase(fetchBookingSlots.rejected, (s) => {
        s.slotsLoading = false;
      })
      .addCase(submitBooking.pending, (s) => {
        s.submitting = true;
        s.submitError = null;
      })
      .addCase(submitBooking.fulfilled, (s) => {
        s.submitting = false;
        s.booked = true;
      })
      .addCase(submitBooking.rejected, (s, a) => {
        s.submitting = false;
        s.submitError = a.payload || "errors.server";
      })
      .addCase(fetchManagedAppointment.fulfilled, (s, a) => {
        s.manage = a.payload;
        s.manageError = null;
      })
      .addCase(fetchManagedAppointment.rejected, (s, a) => {
        s.manageError = a.payload || "errors.notFound";
      });
    for (const t of [cancelManagedAppointment, rescheduleManagedAppointment]) {
      b.addCase(t.pending, (s) => {
        s.manageBusy = true;
        s.manageError = null;
      })
        .addCase(t.fulfilled, (s) => {
          s.manageBusy = false;
        })
        .addCase(t.rejected, (s, a) => {
          s.manageBusy = false;
          s.manageError = a.payload || "errors.server";
        });
    }
  },
});

export const { resetBooking } = slice.actions;
export default slice.reducer;
