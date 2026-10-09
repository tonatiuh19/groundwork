import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  SubmitContactRequest,
  SubmitContactResponse,
  SubmitPartnerReferralRequest,
  SubmitPartnerReferralResponse,
} from "@shared/api";
import { api, formatAxiosError } from "@/lib/api";
import { getReferralCode } from "@/lib/referral";
import { logger } from "@/utils/logger";

export const submitContact = createAsyncThunk<
  SubmitContactResponse,
  SubmitContactRequest,
  { rejectValue: string }
>("contact/submit", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post<SubmitContactResponse>("/public/contact", {
      ...payload,
      referral_code: payload.referral_code ?? getReferralCode() ?? null,
    });
    return data;
  } catch (error) {
    const message = formatAxiosError(error, "errors.submitFailed");
    logger.error("contact", message);
    return rejectWithValue(message);
  }
});

export const submitPartnerReferral = createAsyncThunk<
  SubmitPartnerReferralResponse,
  SubmitPartnerReferralRequest,
  { rejectValue: string }
>("partner/submit", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post<SubmitPartnerReferralResponse>(
      "/public/partner-referral",
      {
        ...payload,
        referral_code: payload.referral_code ?? getReferralCode() ?? null,
      },
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
  /** When contact intent=partner creates a pending affiliate. */
  submittedKind: "contact" | "partner_affiliate" | null;
  error: string | null;
};

const initial: FormState = {
  submitting: false,
  submitted: false,
  submittedKind: null,
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
      .addCase(submitContact.fulfilled, (state, action) => {
        state.contact.submitting = false;
        state.contact.submitted = true;
        state.contact.submittedKind =
          "kind" in action.payload && action.payload.kind === "partner_affiliate"
            ? "partner_affiliate"
            : "contact";
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
        state.partner.submittedKind = "partner_affiliate";
      })
      .addCase(submitPartnerReferral.rejected, (state, action) => {
        state.partner.submitting = false;
        state.partner.error = action.payload || "errors.submitFailed";
      });
  },
});

export const { resetContactForm, resetPartnerForm } = contactSlice.actions;
export default contactSlice.reducer;
