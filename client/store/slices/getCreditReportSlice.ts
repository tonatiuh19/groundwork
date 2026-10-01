import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  SubmitGetCreditReportLeadRequest,
  SubmitGetCreditReportLeadResponse,
} from "@shared/api";
import { api, formatAxiosError } from "@/lib/api";
import { getReferralCode } from "@/lib/referral";
import { logger } from "@/utils/logger";

export const submitGetCreditReportLead = createAsyncThunk<
  SubmitGetCreditReportLeadResponse,
  SubmitGetCreditReportLeadRequest,
  { rejectValue: string }
>("gcr/submit", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post<SubmitGetCreditReportLeadResponse>(
      "/public/get-credit-report-lead",
      { ...payload, referral_code: payload.referral_code ?? getReferralCode() },
    );
    return data;
  } catch (error) {
    const message = formatAxiosError(error, "errors.submitFailed");
    logger.error("gcr", message);
    return rejectWithValue(message);
  }
});

type GcrState = {
  submitting: boolean;
  error: string | null;
  result: SubmitGetCreditReportLeadResponse | null;
};

const initialState: GcrState = {
  submitting: false,
  error: null,
  result: null,
};

const getCreditReportSlice = createSlice({
  name: "gcr",
  initialState,
  reducers: {
    clearGetCreditReportLead(state) {
      state.result = null;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitGetCreditReportLead.pending, (state) => {
        state.submitting = true;
        state.error = null;
      })
      .addCase(submitGetCreditReportLead.fulfilled, (state, action) => {
        state.submitting = false;
        state.result = action.payload;
      })
      .addCase(submitGetCreditReportLead.rejected, (state, action) => {
        state.submitting = false;
        state.error = action.payload || "errors.submitFailed";
      });
  },
});

export const { clearGetCreditReportLead } = getCreditReportSlice.actions;
export default getCreditReportSlice.reducer;
