import { createSlice } from "@reduxjs/toolkit";
import type { AffiliateSignupRequest, ContractorInvitePreview } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type State = {
  signup: { submitting: boolean; done: boolean; error: string | null };
  invite: {
    preview: ContractorInvitePreview | null;
    loading: boolean;
    accepting: boolean;
    accepted: boolean;
    error: string | null;
  };
};

const initialState: State = {
  signup: { submitting: false, done: false, error: null },
  invite: { preview: null, loading: false, accepting: false, accepted: false, error: null },
};

export const submitAffiliateSignup = createApiThunk<unknown, AffiliateSignupRequest>(
  "onboarding/affiliateSignup",
  null,
  async (body) => (await api.post("/public/affiliate/signup", body)).data,
);
export const fetchContractorInvite = createApiThunk<ContractorInvitePreview, string>(
  "onboarding/invitePreview",
  null,
  async (token) => (await api.get(`/public/contractor-invite/${token}`)).data,
);
export const acceptContractorInvite = createApiThunk<unknown, string>(
  "onboarding/inviteAccept",
  null,
  async (token) => (await api.post("/public/contractor-invite/accept", { token })).data,
);

const slice = createSlice({
  name: "onboarding",
  initialState,
  reducers: {
    resetAffiliateSignup(state) {
      state.signup = { submitting: false, done: false, error: null };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitAffiliateSignup.pending, (s) => {
        s.signup = { submitting: true, done: false, error: null };
      })
      .addCase(submitAffiliateSignup.fulfilled, (s) => {
        s.signup = { submitting: false, done: true, error: null };
      })
      .addCase(submitAffiliateSignup.rejected, (s, a) => {
        s.signup = { submitting: false, done: false, error: a.payload || "errors.server" };
      })
      .addCase(fetchContractorInvite.pending, (s) => {
        s.invite.loading = true;
        s.invite.error = null;
      })
      .addCase(fetchContractorInvite.fulfilled, (s, a) => {
        s.invite.loading = false;
        s.invite.preview = a.payload;
      })
      .addCase(fetchContractorInvite.rejected, (s, a) => {
        s.invite.loading = false;
        s.invite.error = a.payload || "errors.server";
      })
      .addCase(acceptContractorInvite.pending, (s) => {
        s.invite.accepting = true;
        s.invite.error = null;
      })
      .addCase(acceptContractorInvite.fulfilled, (s) => {
        s.invite.accepting = false;
        s.invite.accepted = true;
      })
      .addCase(acceptContractorInvite.rejected, (s, a) => {
        s.invite.accepting = false;
        s.invite.error = a.payload || "errors.server";
      });
  },
});

export const { resetAffiliateSignup } = slice.actions;
export default slice.reducer;
