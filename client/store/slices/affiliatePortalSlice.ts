import { createSlice } from "@reduxjs/toolkit";
import type {
  AffiliateClientRow,
  AffiliateCommissionRow,
  AffiliateOverview,
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
  loading: boolean;
  error: string | null;
  registering: boolean;
  registerError: string | null;
};

const initialState: State = {
  overview: null,
  clients: [],
  commissions: [],
  plans: [],
  loading: false,
  error: null,
  registering: false,
  registerError: null,
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

const slice = createSlice({
  name: "affiliatePortal",
  initialState,
  reducers: {
    clearRegisterError(state) {
      state.registerError = null;
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
      });
  },
});

export const { clearRegisterError } = slice.actions;
export default slice.reducer;
