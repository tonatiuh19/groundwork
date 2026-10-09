import { createSlice } from "@reduxjs/toolkit";
import type {
  AffiliateClientRow,
  AffiliateCommissionRow,
  AffiliateOverview,
  AffiliateTeamMember,
  PublicAduPlan,
  RegisterClientRequest,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type State = {
  overview: AffiliateOverview | null;
  clients: AffiliateClientRow[];
  commissions: AffiliateCommissionRow[];
  plans: PublicAduPlan[];
  team: AffiliateTeamMember[];
  subClients: AffiliateClientRow[];
  subCommissions: AffiliateCommissionRow[];
  loading: boolean;
  teamLoading: boolean;
  error: string | null;
  teamError: string | null;
  registering: boolean;
  registerError: string | null;
  inviting: boolean;
  inviteError: string | null;
  teamMutating: boolean;
};

const initialState: State = {
  overview: null,
  clients: [],
  commissions: [],
  plans: [],
  team: [],
  subClients: [],
  subCommissions: [],
  loading: false,
  teamLoading: false,
  error: null,
  teamError: null,
  registering: false,
  registerError: null,
  inviting: false,
  inviteError: null,
  teamMutating: false,
};

const A = "affiliate" as const;

export const fetchAffiliateOverview = createApiThunk("affiliatePortal/overview", A, async () =>
  (await api.get<AffiliateOverview>("/affiliate/overview")).data,
);
export const fetchAffiliateClients = createApiThunk("affiliatePortal/clients", A, async () =>
  (await api.get<{ clients: AffiliateClientRow[] }>("/affiliate/clients")).data.clients,
);
export const fetchAffiliateCommissions = createApiThunk(
  "affiliatePortal/commissions",
  A,
  async () =>
    (await api.get<{ commissions: AffiliateCommissionRow[] }>("/affiliate/commissions")).data
      .commissions,
);
export const fetchPublicPlans = createApiThunk("affiliatePortal/plans", null, async () =>
  (await api.get<{ plans: PublicAduPlan[] }>("/public/plans")).data.plans,
);
export const registerAffiliateClient = createApiThunk<
  { project_public_id: string },
  RegisterClientRequest
>("affiliatePortal/register", A, async (body) =>
  (await api.post("/affiliate/clients", body)).data,
);

export const fetchAffiliateTeam = createApiThunk("affiliatePortal/team", A, async () =>
  (await api.get<{ team: AffiliateTeamMember[] }>("/affiliate/team")).data.team,
);
export const inviteAffiliateSub = createApiThunk<
  { affiliate_id: number },
  {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    company?: string;
    preferred_language?: string;
  }
>("affiliatePortal/inviteSub", A, async (body) =>
  (await api.post("/affiliate/team", body)).data,
);
export const resendAffiliateSubInvite = createApiThunk(
  "affiliatePortal/resendSub",
  A,
  async (id: number) => (await api.post(`/affiliate/team/${id}/resend`)).data,
);
export const patchAffiliateSub = createApiThunk<
  { ok: boolean },
  { id: number; status: "active" | "inactive" }
>("affiliatePortal/patchSub", A, async ({ id, status }) =>
  (await api.patch(`/affiliate/team/${id}`, { status })).data,
);
export const fetchAffiliateSubClients = createApiThunk(
  "affiliatePortal/subClients",
  A,
  async (id: number) =>
    (await api.get<{ clients: AffiliateClientRow[] }>(`/affiliate/team/${id}/clients`)).data
      .clients,
);
export const fetchAffiliateSubCommissions = createApiThunk(
  "affiliatePortal/subCommissions",
  A,
  async (id: number) =>
    (
      await api.get<{ commissions: AffiliateCommissionRow[] }>(
        `/affiliate/team/${id}/commissions`,
      )
    ).data.commissions,
);

const slice = createSlice({
  name: "affiliatePortal",
  initialState,
  reducers: {
    clearRegisterError(state) {
      state.registerError = null;
    },
    clearTeamError(state) {
      state.teamError = null;
      state.inviteError = null;
    },
  },
  extraReducers: (builder) => {
    const pending = (state: State) => {
      state.loading = true;
      state.error = null;
    };
    const rejected = (state: State, action: { payload?: string }) => {
      state.loading = false;
      state.error = action.payload || "errors.server";
    };
    builder
      .addCase(fetchAffiliateOverview.pending, pending)
      .addCase(fetchAffiliateOverview.fulfilled, (s, a) => {
        s.loading = false;
        s.overview = a.payload;
      })
      .addCase(fetchAffiliateOverview.rejected, rejected)
      .addCase(fetchAffiliateClients.pending, pending)
      .addCase(fetchAffiliateClients.fulfilled, (s, a) => {
        s.loading = false;
        s.clients = a.payload;
      })
      .addCase(fetchAffiliateClients.rejected, rejected)
      .addCase(fetchAffiliateCommissions.pending, pending)
      .addCase(fetchAffiliateCommissions.fulfilled, (s, a) => {
        s.loading = false;
        s.commissions = a.payload;
      })
      .addCase(fetchAffiliateCommissions.rejected, rejected)
      .addCase(fetchPublicPlans.fulfilled, (s, a) => {
        s.plans = a.payload;
      })
      .addCase(registerAffiliateClient.pending, (s) => {
        s.registering = true;
        s.registerError = null;
      })
      .addCase(registerAffiliateClient.fulfilled, (s) => {
        s.registering = false;
      })
      .addCase(registerAffiliateClient.rejected, (s, a) => {
        s.registering = false;
        s.registerError = a.payload || "errors.server";
      })
      .addCase(fetchAffiliateTeam.pending, (s) => {
        s.teamLoading = true;
        s.teamError = null;
      })
      .addCase(fetchAffiliateTeam.fulfilled, (s, a) => {
        s.teamLoading = false;
        s.team = a.payload;
      })
      .addCase(fetchAffiliateTeam.rejected, (s, a) => {
        s.teamLoading = false;
        s.teamError = a.payload || "errors.server";
      })
      .addCase(inviteAffiliateSub.pending, (s) => {
        s.inviting = true;
        s.inviteError = null;
      })
      .addCase(inviteAffiliateSub.fulfilled, (s) => {
        s.inviting = false;
      })
      .addCase(inviteAffiliateSub.rejected, (s, a) => {
        s.inviting = false;
        s.inviteError = a.payload || "errors.server";
      })
      .addCase(resendAffiliateSubInvite.pending, (s) => {
        s.teamMutating = true;
        s.teamError = null;
      })
      .addCase(resendAffiliateSubInvite.fulfilled, (s) => {
        s.teamMutating = false;
      })
      .addCase(resendAffiliateSubInvite.rejected, (s, a) => {
        s.teamMutating = false;
        s.teamError = a.payload || "errors.server";
      })
      .addCase(patchAffiliateSub.pending, (s) => {
        s.teamMutating = true;
        s.teamError = null;
      })
      .addCase(patchAffiliateSub.fulfilled, (s) => {
        s.teamMutating = false;
      })
      .addCase(patchAffiliateSub.rejected, (s, a) => {
        s.teamMutating = false;
        s.teamError = a.payload || "errors.server";
      })
      .addCase(fetchAffiliateSubClients.fulfilled, (s, a) => {
        s.subClients = a.payload;
      })
      .addCase(fetchAffiliateSubCommissions.fulfilled, (s, a) => {
        s.subCommissions = a.payload;
      });
  },
});

export const { clearRegisterError, clearTeamError } = slice.actions;
export default slice.reducer;
