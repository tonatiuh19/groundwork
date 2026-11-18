import { createSlice } from "@reduxjs/toolkit";
import type { BookingTypeKey, PublicAppointmentView, PublicBookingInfo } from "@shared/api";
import { api } from "@/lib/api";
import { resetShield, withShield } from "@/store/slices/spamShieldSlice";
import { createApiThunk } from "@/lib/portalThunk";

/** Public booking page (/book/:slug) and "manage my appointment" (/appointment/:token). */

export const fetchBookingInfo = createApiThunk<PublicBookingInfo, { slug: string; lang: "en" | "es"; type?: BookingTypeKey }>(
  "booking/info",
  null,
  async ({ slug, lang, type }) => (await api.get(`/public/book/${encodeURIComponent(slug)}`, { params: { lang, type } })).data,
);

/** Open times are cached per call type + day (types have different lengths). */
export const slotKey = (type: BookingTypeKey | undefined, date: string) => `${type || "homeowner"}|${date}`;

export const fetchBookingSlots = createApiThunk<{ date: string; slots: string[] }, { slug: string; date: string; type?: BookingTypeKey }>(
  "booking/slots",
  null,
  async ({ slug, date, type }) => (await api.get(`/public/book/${encodeURIComponent(slug)}/slots`, { params: { date, type } })).data,
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
  type?: BookingTypeKey;
  /** Affiliate link the visitor came through (credited on new leads). */
  referral_code?: string;
  /** 6-digit code texted when the spam shield asked to confirm the phone. */
  phone_code?: string;
};

/**
 * Book. When the spam shield isn't sure, the server texts a code first and answers 202 `needs_code`;
 * the page then sends the same booking again with `phone_code` (same shield token until it's done).
 */
export const submitBooking = createApiThunk<{ appointment_id?: number; needs_code?: boolean; phone_last4?: string }, { slug: string; body: BookingForm }>(
  "booking/submit",
  null,
  async ({ slug, body }) => {
    try {
      const r = await api.post(`/public/book/${encodeURIComponent(slug)}`, await withShield("booking", body, { keep: true }));
      if (!r.data?.needs_code) resetShield("booking");
      return r.data;
    } catch (e) {
      // A wrong / expired code keeps the token (they retry); anything else starts fresh.
      const key = (e as any)?.response?.data?.error;
      if (!["errors.bookingCodeInvalid", "errors.bookingCodeExpired"].includes(key)) resetShield("booking");
      throw e;
    }
  },
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
  /** Last 4 digits the code was texted to (spam shield asked to confirm the phone); null = no code step. */
  needsCode: string | null;
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
  needsCode: null,
  manage: null,
  manageError: null,
  manageBusy: false,
};

const slice = createSlice({
  name: "booking",
  initialState,
  reducers: {
    resetBooking: () => initialState,
    /** "Change my number" on the code step: back to the details form. */
    clearBookingCode: (s) => {
      s.needsCode = null;
      s.submitError = null;
    },
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
        s.slots[slotKey(a.meta.arg.type, a.payload.date)] = a.payload.slots;
      })
      .addCase(fetchBookingSlots.rejected, (s) => {
        s.slotsLoading = false;
      })
      .addCase(submitBooking.pending, (s) => {
        s.submitting = true;
        s.submitError = null;
      })
      .addCase(submitBooking.fulfilled, (s, a) => {
        s.submitting = false;
        // 202 "confirm your phone": not booked yet, the page shows the code step.
        s.needsCode = a.payload.needs_code ? a.payload.phone_last4 || "" : null;
        s.booked = !a.payload.needs_code;
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

export const { resetBooking, clearBookingCode } = slice.actions;
export default slice.reducer;
