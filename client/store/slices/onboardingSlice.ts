import { createSlice } from "@reduxjs/toolkit";
import type {
  AffiliateSignupRequest,
  ClientSignupRequest,
  ContractorInvitePreview,
  ContractorSignupRequest,
  PortalSignupOutcome,
  PortalSignupResponse,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type SignupSlot = {
  submitting: boolean;
  done: boolean;
  outcome: PortalSignupOutcome | null;
  error: string | null;
};

type State = {
  signup: SignupSlot;
  clientSignup: SignupSlot;
  contractorSignup: SignupSlot;
  invite: {
    preview: ContractorInvitePreview | null;
    loading: boolean;
    accepting: boolean;
    accepted: boolean;
    /** Set when accepting starts the prequalification application. */
    applicationPath: string | null;
    error: string | null;
  };
};

const emptySignup = (): SignupSlot => ({
  submitting: false,
  done: false,
  outcome: null,
  error: null,
});

const initialState: State = {
  signup: emptySignup(),
  clientSignup: emptySignup(),
  contractorSignup: emptySignup(),
  invite: {
    preview: null,
    loading: false,
    accepting: false,
    accepted: false,
    applicationPath: null,
    error: null,
  },
};

function outcomeFrom(payload: unknown): PortalSignupOutcome {
  if (
    payload &&
    typeof payload === "object" &&
    "outcome" in payload &&
    typeof (payload as PortalSignupResponse).outcome === "string"
  ) {
    return (payload as PortalSignupResponse).outcome;
  }
  return "created";
}

export const submitAffiliateSignup = createApiThunk<
  { ok: true },
  AffiliateSignupRequest
>(
  "onboarding/affiliateSignup",
  null,
  async (body) => (await api.post("/public/affiliate/signup", body)).data,
);
export const submitClientSignup = createApiThunk<
  PortalSignupResponse,
  ClientSignupRequest
>(
  "onboarding/clientSignup",
  null,
  async (body) => (await api.post("/public/client/signup", body)).data,
);
export const submitContractorSignup = createApiThunk<
  PortalSignupResponse,
  ContractorSignupRequest
>(
  "onboarding/contractorSignup",
  null,
  async (body) => (await api.post("/public/contractor/signup", body)).data,
);
export const fetchContractorInvite = createApiThunk<
  ContractorInvitePreview,
  string
>(
  "onboarding/invitePreview",
  null,
  async (token) => (await api.get(`/public/contractor-invite/${token}`)).data,
);
export const acceptContractorInvite = createApiThunk<
  { ok: true; email: string; next?: "login" | "application"; application_path?: string },
  string
>(
  "onboarding/inviteAccept",
  null,
  async (token) =>
    (await api.post("/public/contractor-invite/accept", { token })).data,
);

const slice = createSlice({
  name: "onboarding",
  initialState,
  reducers: {
    resetAffiliateSignup(state) {
      state.signup = emptySignup();
    },
    resetClientSignup(state) {
      state.clientSignup = emptySignup();
    },
    resetContractorSignup(state) {
      state.contractorSignup = emptySignup();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitAffiliateSignup.pending, (s) => {
        s.signup = { submitting: true, done: false, outcome: null, error: null };
      })
      .addCase(submitAffiliateSignup.fulfilled, (s) => {
        s.signup = {
          submitting: false,
          done: true,
          outcome: "created",
          error: null,
        };
      })
      .addCase(submitAffiliateSignup.rejected, (s, a) => {
        s.signup = {
          submitting: false,
          done: false,
          outcome: null,
          error: a.payload || "errors.server",
        };
      })
      .addCase(submitClientSignup.pending, (s) => {
        s.clientSignup = {
          submitting: true,
          done: false,
          outcome: null,
          error: null,
        };
      })
      .addCase(submitClientSignup.fulfilled, (s, a) => {
        s.clientSignup = {
          submitting: false,
          done: true,
          outcome: outcomeFrom(a.payload),
          error: null,
        };
      })
      .addCase(submitClientSignup.rejected, (s, a) => {
        s.clientSignup = {
          submitting: false,
          done: false,
          outcome: null,
          error: a.payload || "errors.server",
        };
      })
      .addCase(submitContractorSignup.pending, (s) => {
        s.contractorSignup = {
          submitting: true,
          done: false,
          outcome: null,
          error: null,
        };
      })
      .addCase(submitContractorSignup.fulfilled, (s, a) => {
        s.contractorSignup = {
          submitting: false,
          done: true,
          outcome: outcomeFrom(a.payload),
          error: null,
        };
      })
      .addCase(submitContractorSignup.rejected, (s, a) => {
        s.contractorSignup = {
          submitting: false,
          done: false,
          outcome: null,
          error: a.payload || "errors.server",
        };
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
      .addCase(acceptContractorInvite.fulfilled, (s, a) => {
        s.invite.accepting = false;
        s.invite.accepted = true;
        s.invite.applicationPath =
          a.payload?.next === "application" ? a.payload.application_path ?? null : null;
      })
      .addCase(acceptContractorInvite.rejected, (s, a) => {
        s.invite.accepting = false;
        s.invite.error = a.payload || "errors.server";
      });
  },
});

export const {
  resetAffiliateSignup,
  resetClientSignup,
  resetContractorSignup,
} = slice.actions;
export default slice.reducer;
