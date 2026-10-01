import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  EventRegistrationStatus,
  SubmitLeadRequest,
  SubmitLeadResponse,
} from "@shared/api";
import { api, formatAxiosError } from "@/lib/api";
import { getReferralCode } from "@/lib/referral";
import { logger } from "@/utils/logger";

export const submitLead = createAsyncThunk<
  SubmitLeadResponse,
  SubmitLeadRequest,
  { rejectValue: string }
>("lead/submit", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post<SubmitLeadResponse>("/public/leads", {
      ...payload,
      referral_code: payload.referral_code ?? getReferralCode(),
    });
    return data;
  } catch (error) {
    const message = formatAxiosError(error, "errors.submitFailed");
    logger.error("lead", message);
    return rejectWithValue(message);
  }
});

type LeadState = {
  submitting: boolean;
  submitted: boolean;
  error: string | null;
  lastMessage: string | null;
  lastLeadId: number | null;
  /** Event RSVP outcome (`confirmed` / `waitlisted`) for the success state. */
  eventRegistrationStatus: EventRegistrationStatus | null;
  /** Next-step credit CTA returned with an event RSVP. */
  creditCtaUrl: string | null;
};

const initialState: LeadState = {
  submitting: false,
  submitted: false,
  error: null,
  lastMessage: null,
  lastLeadId: null,
  eventRegistrationStatus: null,
  creditCtaUrl: null,
};

const leadSlice = createSlice({
  name: "lead",
  initialState,
  reducers: {
    resetLeadForm(state) {
      state.submitted = false;
      state.error = null;
      state.lastMessage = null;
      state.lastLeadId = null;
      state.eventRegistrationStatus = null;
      state.creditCtaUrl = null;
    },
    clearLeadError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitLead.pending, (state) => {
        state.submitting = true;
        state.error = null;
      })
      .addCase(submitLead.fulfilled, (state, action) => {
        state.submitting = false;
        state.submitted = true;
        state.lastMessage = action.payload.message;
        state.lastLeadId = action.payload.lead_id;
        state.eventRegistrationStatus = action.payload.event_registration_status ?? null;
        state.creditCtaUrl = action.payload.credit_cta_url ?? null;
      })
      .addCase(submitLead.rejected, (state, action) => {
        state.submitting = false;
        state.error = action.payload || "errors.submitFailed";
      });
  },
});

export const { resetLeadForm, clearLeadError } = leadSlice.actions;
export default leadSlice.reducer;
