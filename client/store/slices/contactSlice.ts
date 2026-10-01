import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  SubmitContactRequest,
  SubmitPartnerReferralRequest,
  SubmitSimpleLeadResponse,
} from "@shared/api";
import { api, formatAxiosError } from "@/lib/api";
import { logger } from "@/utils/logger";

export const submitContact = createAsyncThunk<
  SubmitSimpleLeadResponse,
  SubmitContactRequest,
  { rejectValue: string }
>("contact/submit", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post<SubmitSimpleLeadResponse>(
      "/public/contact",
      payload,
    );
    return data;
  } catch (error) {
    const message = formatAxiosError(error, "errors.submitFailed");
    logger.error("contact", message);
    return rejectWithValue(message);
  }
});

export const submitPartnerReferral = createAsyncThunk<
  SubmitSimpleLeadResponse,
  SubmitPartnerReferralRequest,
  { rejectValue: string }
>("partner/submit", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post<SubmitSimpleLeadResponse>(
      "/public/partner-referral",
      payload,
    );
    return data;
  } catch (error) {
    const message = formatAxiosError(error, "errors.submitFailed");
    logger.error("partner", message);
    return rejectWithValue(message);
  }
});

type FormState = {
  submitting: boolean;
  submitted: boolean;
  error: string | null;
};

const initial: FormState = {
  submitting: false,
  submitted: false,
  error: null,
};

const contactSlice = createSlice({
  name: "contact",
  initialState: { contact: { ...initial }, partner: { ...initial } },
  reducers: {
    resetContactForm(state) {
      state.contact = { ...initial };
    },
    resetPartnerForm(state) {
      state.partner = { ...initial };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitContact.pending, (state) => {
        state.contact.submitting = true;
        state.contact.error = null;
      })
      .addCase(submitContact.fulfilled, (state) => {
        state.contact.submitting = false;
        state.contact.submitted = true;
      })
      .addCase(submitContact.rejected, (state, action) => {
        state.contact.submitting = false;
        state.contact.error = action.payload || "errors.submitFailed";
      })
      .addCase(submitPartnerReferral.pending, (state) => {
        state.partner.submitting = true;
        state.partner.error = null;
      })
      .addCase(submitPartnerReferral.fulfilled, (state) => {
        state.partner.submitting = false;
        state.partner.submitted = true;
      })
      .addCase(submitPartnerReferral.rejected, (state, action) => {
        state.partner.submitting = false;
        state.partner.error = action.payload || "errors.submitFailed";
      });
  },
});

export const { resetContactForm, resetPartnerForm } = contactSlice.actions;
export default contactSlice.reducer;
