import { createSlice } from "@reduxjs/toolkit";
import type {
  Campaign,
  CampaignAudiencePreview,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type State = {
  items: Campaign[];
  active: Campaign | null;
  preview: CampaignAudiencePreview | null;
  loading: boolean;
  saving: boolean;
  sending: boolean;
  error: string | null;
  lastStats: Record<string, number> | null;
};

const initialState: State = {
  items: [],
  active: null,
  preview: null,
  loading: false,
  saving: false,
  sending: false,
  error: null,
  lastStats: null,
};

const A = "admin" as const;

export const fetchCampaigns = createApiThunk(
  "campaigns/list",
  A,
  async () => {
    const { data } = await api.get<{ campaigns: Campaign[] }>(
      "/admin/campaigns",
    );
    return data.campaigns || [];
  },
);

export const fetchCampaign = createApiThunk(
  "campaigns/get",
  A,
  async (id: number) => {
    const { data } = await api.get<{ campaign: Campaign }>(
      `/admin/campaigns/${id}`,
    );
    return data.campaign;
  },
);

export const createCampaign = createApiThunk(
  "campaigns/create",
  A,
  async (body: Record<string, unknown>) => {
    const { data } = await api.post<{ campaign: Campaign }>(
      "/admin/campaigns",
      body,
    );
    return data.campaign;
  },
);

export const updateCampaign = createApiThunk(
  "campaigns/update",
  A,
  async (arg: { id: number; patch: Record<string, unknown> }) => {
    const { data } = await api.patch<{ campaign: Campaign }>(
      `/admin/campaigns/${arg.id}`,
      arg.patch,
    );
    return data.campaign;
  },
);

export const deleteCampaign = createApiThunk(
  "campaigns/delete",
  A,
  async (id: number) => {
    await api.delete(`/admin/campaigns/${id}`);
    return id;
  },
);

export const previewCampaign = createApiThunk(
  "campaigns/preview",
  A,
  async (arg: { id: number; audience_filter?: Record<string, unknown> }) => {
    const { data } = await api.post<{ preview: CampaignAudiencePreview }>(
      `/admin/campaigns/${arg.id}/preview`,
      { audience_filter: arg.audience_filter },
    );
    return data.preview;
  },
);

export const sendCampaign = createApiThunk(
  "campaigns/send",
  A,
  async (arg: { id: number; dry_run?: boolean; confirm?: boolean }) => {
    const { data } = await api.post<{
      campaign: Campaign;
      stats: Record<string, number>;
      dry_run: boolean;
    }>(`/admin/campaigns/${arg.id}/send`, {
      dry_run: !!arg.dry_run,
      confirm: !!arg.confirm,
    });
    return data;
  },
);

const campaignsSlice = createSlice({
  name: "campaigns",
  initialState,
  reducers: {
    clearCampaignError(state) {
      state.error = null;
    },
    clearCampaignPreview(state) {
      state.preview = null;
      state.lastStats = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchCampaigns.pending, (s) => {
      s.loading = true;
      s.error = null;
    });
    b.addCase(fetchCampaigns.fulfilled, (s, a) => {
      s.loading = false;
      s.items = a.payload;
    });
    b.addCase(fetchCampaigns.rejected, (s, a) => {
      s.loading = false;
      s.error = (a.payload as string) || "errors.server";
    });

    b.addCase(fetchCampaign.fulfilled, (s, a) => {
      s.active = a.payload;
    });

    b.addCase(createCampaign.pending, (s) => {
      s.saving = true;
      s.error = null;
    });
    b.addCase(createCampaign.fulfilled, (s, a) => {
      s.saving = false;
      s.active = a.payload;
      s.items = [a.payload, ...s.items];
    });
    b.addCase(createCampaign.rejected, (s, a) => {
      s.saving = false;
      s.error = (a.payload as string) || "errors.server";
    });

    b.addCase(updateCampaign.pending, (s) => {
      s.saving = true;
      s.error = null;
    });
    b.addCase(updateCampaign.fulfilled, (s, a) => {
      s.saving = false;
      s.active = a.payload;
      s.items = s.items.map((c) => (c.id === a.payload.id ? a.payload : c));
    });
    b.addCase(updateCampaign.rejected, (s, a) => {
      s.saving = false;
      s.error = (a.payload as string) || "errors.server";
    });

    b.addCase(deleteCampaign.fulfilled, (s, a) => {
      s.items = s.items.filter((c) => c.id !== a.payload);
      if (s.active?.id === a.payload) s.active = null;
    });

    b.addCase(previewCampaign.pending, (s) => {
      s.loading = true;
      s.error = null;
    });
    b.addCase(previewCampaign.fulfilled, (s, a) => {
      s.loading = false;
      s.preview = a.payload;
    });
    b.addCase(previewCampaign.rejected, (s, a) => {
      s.loading = false;
      s.error = (a.payload as string) || "errors.server";
    });

    b.addCase(sendCampaign.pending, (s) => {
      s.sending = true;
      s.error = null;
    });
    b.addCase(sendCampaign.fulfilled, (s, a) => {
      s.sending = false;
      s.active = a.payload.campaign;
      s.lastStats = a.payload.stats;
      s.items = s.items.map((c) =>
        c.id === a.payload.campaign.id ? a.payload.campaign : c,
      );
    });
    b.addCase(sendCampaign.rejected, (s, a) => {
      s.sending = false;
      s.error = (a.payload as string) || "errors.server";
    });
  },
});

export const { clearCampaignError, clearCampaignPreview } =
  campaignsSlice.actions;
export default campaignsSlice.reducer;
