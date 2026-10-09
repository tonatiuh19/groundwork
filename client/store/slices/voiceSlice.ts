import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

const A = "admin" as const;

export type VoiceDeviceStatus =
  | "offline"
  | "connecting"
  | "ready"
  | "error";

export type OutboundCallState = {
  phone: string;
  clientId?: number | null;
  clientName?: string | null;
  startedAt: number;
} | null;

type VoiceState = {
  isAvailable: boolean;
  deviceStatus: VoiceDeviceStatus;
  tokenError: string | null;
  outboundCall: OutboundCallState;
  dialpadOpen: boolean;
  settingsOpen: boolean;
  callForwarding: {
    enabled: boolean;
    phone: string | null;
    loading: boolean;
    saving: boolean;
  };
  voicemail: {
    adminEnabled: boolean | null;
    greetingText: string | null;
    tenantEnabled: boolean;
    tenantGreeting: string | null;
    maxSeconds: number;
    loading: boolean;
    saving: boolean;
  };
};

const initialState: VoiceState = {
  /** Softphone defaults to Available (staff must opt out). */
  isAvailable: true,
  deviceStatus: "offline",
  tokenError: null,
  outboundCall: null,
  dialpadOpen: false,
  settingsOpen: false,
  callForwarding: {
    enabled: false,
    phone: null,
    loading: false,
    saving: false,
  },
  voicemail: {
    adminEnabled: null,
    greetingText: null,
    tenantEnabled: true,
    tenantGreeting: null,
    maxSeconds: 120,
    loading: false,
    saving: false,
  },
};

export const fetchVoiceToken = createApiThunk<string, void>(
  "voice/fetchToken",
  A,
  async () => {
    const { data } = await api.post<{ success: boolean; token: string }>(
      "/voice/token",
      {},
    );
    if (!data?.token) throw new Error("errors.server");
    return data.token;
  },
);

export const updateVoiceAvailability = createApiThunk<boolean, boolean>(
  "voice/updateAvailability",
  A,
  async (available) => {
    await api.post("/voice/availability", { available });
    return available;
  },
);

export const logVoiceCall = createApiThunk<
  true,
  {
    phone: string;
    duration: number;
    call_status: string;
    call_sid?: string;
    client_id?: number;
    direction?: "inbound" | "outbound";
  }
>("voice/logCall", A, async (payload) => {
  await api.post("/voice/log", payload);
  return true;
});

export const lookupContactByPhone = createApiThunk<
  {
    found: boolean;
    client_name?: string | null;
    client_id?: number | null;
    kind?: string;
  },
  string
>("voice/lookupContact", A, async (phone) => {
  const { data } = await api.get("/admin/conversations/lookup-contact", {
    params: { phone },
  });
  return data;
});

export const fetchVoiceCallForwarding = createApiThunk<
  { enabled: boolean; phone: string | null },
  void
>("voice/callForwardingGet", A, async () => {
  const { data } = await api.get<{
    call_forwarding_enabled: boolean;
    call_forwarding_phone: string | null;
  }>("/voice/call-forwarding");
  return {
    enabled: !!data.call_forwarding_enabled,
    phone: data.call_forwarding_phone ?? null,
  };
});

export const saveVoiceCallForwarding = createApiThunk<
  { enabled: boolean; phone: string | null },
  { enabled: boolean; phone?: string }
>("voice/callForwardingPut", A, async (body) => {
  const { data } = await api.put<{
    call_forwarding_enabled: boolean;
    call_forwarding_phone: string | null;
  }>("/voice/call-forwarding", body);
  return {
    enabled: !!data.call_forwarding_enabled,
    phone: data.call_forwarding_phone ?? null,
  };
});

export const fetchVoicemailSettings = createApiThunk<
  {
    adminEnabled: boolean | null;
    greetingText: string | null;
    tenantEnabled: boolean;
    tenantGreeting: string | null;
    maxSeconds: number;
  },
  void
>("voice/voicemailGet", A, async () => {
  const { data } = await api.get<{
    admin: {
      voicemail_enabled: boolean | null;
      voicemail_greeting_text: string | null;
    };
    tenant: {
      voicemail_enabled: boolean;
      voicemail_greeting_text: string | null;
      voicemail_max_seconds: number;
    };
  }>("/voice/voicemail-settings");
  return {
    adminEnabled: data.admin.voicemail_enabled,
    greetingText: data.admin.voicemail_greeting_text,
    tenantEnabled: data.tenant.voicemail_enabled,
    tenantGreeting: data.tenant.voicemail_greeting_text,
    maxSeconds: data.tenant.voicemail_max_seconds,
  };
});

export const saveVoicemailSettings = createApiThunk<
  true,
  { enabled?: boolean | null; greeting_text?: string | null }
>("voice/voicemailPut", A, async (body) => {
  await api.put("/voice/voicemail-settings", body);
  return true;
});

const voiceSlice = createSlice({
  name: "voice",
  initialState,
  reducers: {
    setDeviceStatus(state, action: PayloadAction<VoiceDeviceStatus>) {
      state.deviceStatus = action.payload;
    },
    setVoiceAvailableLocal(state, action: PayloadAction<boolean>) {
      state.isAvailable = action.payload;
    },
    startOutboundCall(
      state,
      action: PayloadAction<{
        phone: string;
        clientId?: number | null;
        clientName?: string | null;
      }>,
    ) {
      state.outboundCall = {
        phone: action.payload.phone,
        clientId: action.payload.clientId ?? null,
        clientName: action.payload.clientName ?? null,
        startedAt: Date.now(),
      };
    },
    endOutboundCall(state) {
      state.outboundCall = null;
    },
    resolveOutboundCallName(
      state,
      action: PayloadAction<{ clientId?: number | null; clientName?: string | null }>,
    ) {
      if (!state.outboundCall) return;
      state.outboundCall.clientId =
        action.payload.clientId ?? state.outboundCall.clientId;
      state.outboundCall.clientName =
        action.payload.clientName ?? state.outboundCall.clientName;
    },
    setDialpadOpen(state, action: PayloadAction<boolean>) {
      state.dialpadOpen = action.payload;
    },
    setVoiceSettingsOpen(state, action: PayloadAction<boolean>) {
      state.settingsOpen = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchVoiceToken.rejected, (state, action) => {
        state.tokenError = action.payload || "errors.server";
        state.deviceStatus = "error";
      })
      .addCase(fetchVoiceToken.fulfilled, (state) => {
        state.tokenError = null;
      })
      .addCase(updateVoiceAvailability.fulfilled, (state, action) => {
        state.isAvailable = action.payload;
      })
      .addCase(fetchVoiceCallForwarding.pending, (state) => {
        state.callForwarding.loading = true;
      })
      .addCase(fetchVoiceCallForwarding.fulfilled, (state, action) => {
        state.callForwarding.loading = false;
        state.callForwarding.enabled = action.payload.enabled;
        state.callForwarding.phone = action.payload.phone;
      })
      .addCase(fetchVoiceCallForwarding.rejected, (state) => {
        state.callForwarding.loading = false;
      })
      .addCase(saveVoiceCallForwarding.pending, (state) => {
        state.callForwarding.saving = true;
      })
      .addCase(saveVoiceCallForwarding.fulfilled, (state, action) => {
        state.callForwarding.saving = false;
        state.callForwarding.enabled = action.payload.enabled;
        state.callForwarding.phone = action.payload.phone;
      })
      .addCase(saveVoiceCallForwarding.rejected, (state) => {
        state.callForwarding.saving = false;
      })
      .addCase(fetchVoicemailSettings.pending, (state) => {
        state.voicemail.loading = true;
      })
      .addCase(fetchVoicemailSettings.fulfilled, (state, action) => {
        state.voicemail.loading = false;
        state.voicemail.adminEnabled = action.payload.adminEnabled;
        state.voicemail.greetingText = action.payload.greetingText;
        state.voicemail.tenantEnabled = action.payload.tenantEnabled;
        state.voicemail.tenantGreeting = action.payload.tenantGreeting;
        state.voicemail.maxSeconds = action.payload.maxSeconds;
      })
      .addCase(fetchVoicemailSettings.rejected, (state) => {
        state.voicemail.loading = false;
      })
      .addCase(saveVoicemailSettings.pending, (state) => {
        state.voicemail.saving = true;
      })
      .addCase(saveVoicemailSettings.fulfilled, (state) => {
        state.voicemail.saving = false;
      })
      .addCase(saveVoicemailSettings.rejected, (state) => {
        state.voicemail.saving = false;
      });
  },
});

export const {
  setDeviceStatus,
  setVoiceAvailableLocal,
  startOutboundCall,
  endOutboundCall,
  resolveOutboundCallName,
  setDialpadOpen,
  setVoiceSettingsOpen,
} = voiceSlice.actions;

export default voiceSlice.reducer;
