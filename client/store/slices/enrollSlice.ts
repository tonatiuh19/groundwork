import { createSlice } from "@reduxjs/toolkit";
import type {
  ClientInvitePreview,
  EnrollOutcome,
  EnrollRequest,
  EnrollResponse,
  PortalAuthResponse,
  PublicAffiliateByCodeResponse,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type State = {
  affiliate: {
    data: PublicAffiliateByCodeResponse | null;
    loading: boolean;
    inactive: boolean;
    error: string | null;
  };
  enroll: {
    submitting: boolean;
    done: boolean;
    projectId: string | null;
    outcome: EnrollOutcome | null;
    error: string | null;
  };
  clientInvite: {
    preview: ClientInvitePreview | null;
    loading: boolean;
    accepting: boolean;
    accepted: boolean;
    error: string | null;
  };
};

const initialState: State = {
  affiliate: { data: null, loading: false, inactive: false, error: null },
  enroll: { submitting: false, done: false, projectId: null, outcome: null, error: null },
  clientInvite: {
    preview: null,
    loading: false,
    accepting: false,
    accepted: false,
    error: null,
  },
};

export const fetchPublicAffiliateByCode = createApiThunk<
  PublicAffiliateByCodeResponse,
  { code: string; to?: string }
>("enroll/affiliateByCode", null, async ({ code, to }) => {
  const params = to ? { to } : undefined;
  const { data } = await api.get<PublicAffiliateByCodeResponse>(
    `/public/affiliates/by-code/${encodeURIComponent(code)}`,
    { params },
  );
  return data;
});

export const submitEnroll = createApiThunk<EnrollResponse, EnrollRequest>(
  "enroll/submit",
  null,
  async (body) => (await api.post<EnrollResponse>("/public/enroll", body)).data,
);

export const fetchClientInvite = createApiThunk<ClientInvitePreview, string>(
  "enroll/clientInvitePreview",
  null,
  async (token) => (await api.get<ClientInvitePreview>(`/public/client-invite/${token}`)).data,
);

export const acceptClientInvite = createApiThunk<PortalAuthResponse, string>(
  "enroll/clientInviteAccept",
  null,
  async (token) =>
    (await api.post<PortalAuthResponse>("/public/client-invite/accept", { token })).data,
);

const slice = createSlice({
  name: "enroll",
  initialState,
  reducers: {
    resetEnrollForm(state) {
      state.enroll = { submitting: false, done: false, projectId: null, outcome: null, error: null };
    },
    clearPublicAffiliate(state) {
      state.affiliate = { data: null, loading: false, inactive: false, error: null };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPublicAffiliateByCode.pending, (s) => {
        s.affiliate.loading = true;
        s.affiliate.inactive = false;
        s.affiliate.error = null;
      })
      .addCase(fetchPublicAffiliateByCode.fulfilled, (s, a) => {
        s.affiliate.loading = false;
        s.affiliate.data = a.payload;
      })
      .addCase(fetchPublicAffiliateByCode.rejected, (s, a) => {
        s.affiliate.loading = false;
        s.affiliate.data = null;
        const key = a.payload || "errors.server";
        if (key === "errors.referralInactive") {
          s.affiliate.inactive = true;
          s.affiliate.error = null;
        } else {
          s.affiliate.error = key;
        }
      })
      .addCase(submitEnroll.pending, (s) => {
        s.enroll.submitting = true;
        s.enroll.error = null;
      })
      .addCase(submitEnroll.fulfilled, (s, a) => {
        s.enroll.submitting = false;
        s.enroll.done = true;
        s.enroll.projectId = a.payload.project_public_id;
        s.enroll.outcome = a.payload.outcome ?? "created";
      })
      .addCase(submitEnroll.rejected, (s, a) => {
        s.enroll.submitting = false;
        s.enroll.error = a.payload || "errors.server";
      })
      .addCase(fetchClientInvite.pending, (s) => {
        s.clientInvite.loading = true;
        s.clientInvite.error = null;
      })
      .addCase(fetchClientInvite.fulfilled, (s, a) => {
        s.clientInvite.loading = false;
        s.clientInvite.preview = a.payload;
      })
      .addCase(fetchClientInvite.rejected, (s, a) => {
        s.clientInvite.loading = false;
        s.clientInvite.preview = null;
        s.clientInvite.error = a.payload || "errors.server";
      })
      .addCase(acceptClientInvite.pending, (s) => {
        s.clientInvite.accepting = true;
        s.clientInvite.error = null;
      })
      .addCase(acceptClientInvite.fulfilled, (s) => {
        s.clientInvite.accepting = false;
        s.clientInvite.accepted = true;
      })
      .addCase(acceptClientInvite.rejected, (s, a) => {
        s.clientInvite.accepting = false;
        s.clientInvite.error = a.payload || "errors.server";
      });
  },
});

export const { resetEnrollForm, clearPublicAffiliate } = slice.actions;
export default slice.reducer;
