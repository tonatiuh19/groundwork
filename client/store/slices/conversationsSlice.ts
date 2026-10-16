import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  ConversationLeadMatch,
  ConversationTemplateCategory,
  AdminPhoneNumber,
  ConversationContactKind,
  ConversationHubContact,
  ConversationMessage,
  ConversationTemplate,
  ConversationThread,
  ConversationTimelineResponse,
  ConversationsAccessResponse,
  ConversationsListResponse,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

export type ConversationsView =
  | "all"
  | "mine"
  | "unassigned"
  | "unread"
  | "unknown"
  | "open"
  | "closed";

const A = "admin" as const;
const PAGE_SIZE = 50;

export type ConversationTimeline = {
  kind: ConversationContactKind;
  contact: Record<string, unknown>;
  threads: ConversationThread[];
  messages: ConversationMessage[];
};

type ConversationsState = {
  accessEnabled: boolean | null;
  accessNumbers: AdminPhoneNumber[];
  accessLoading: boolean;
  inbox: ConversationHubContact[];
  /** Leads matching the inbox search (not yet linked people). */
  leadMatches: ConversationLeadMatch[];
  leadMatchesQuery: string;
  inboxPagination: ConversationsListResponse["pagination"] | null;
  inboxLoading: boolean;
  inboxRefreshing: boolean;
  inboxError: string | null;
  view: ConversationsView;
  search: string;
  activeKind: ConversationContactKind | null;
  activeId: number | null;
  timeline: ConversationTimeline | null;
  timelineLoading: boolean;
  sending: boolean;
  sendError: string | null;
  templates: ConversationTemplate[];
  templatesLoading: boolean;
  ablyTokenRequest: unknown | null;
  ablyLoading: boolean;
  /** Bumped by AdminRealtimeBridge on Ably conversation events (no API poll). */
  realtimeSeq: number;
  navBadgeUnread: number;
  phoneNumbers: AdminPhoneNumber[];
  phoneNumbersLoading: boolean;
  phoneNumbersError: string | null;
  phoneMutating: boolean;
};

const initialState: ConversationsState = {
  accessEnabled: null,
  accessNumbers: [],
  accessLoading: false,
  inbox: [],
  leadMatches: [],
  leadMatchesQuery: "",
  inboxPagination: null,
  inboxLoading: false,
  inboxRefreshing: false,
  inboxError: null,
  view: "all",
  search: "",
  activeKind: null,
  activeId: null,
  timeline: null,
  timelineLoading: false,
  sending: false,
  sendError: null,
  templates: [],
  templatesLoading: false,
  ablyTokenRequest: null,
  ablyLoading: false,
  realtimeSeq: 0,
  navBadgeUnread: 0,
  phoneNumbers: [],
  phoneNumbersLoading: false,
  phoneNumbersError: null,
  phoneMutating: false,
};

function mapMessage(m: Record<string, unknown>): ConversationMessage {
  let meta: Record<string, unknown> | null = null;
  try {
    if (m.metadata_json) {
      meta =
        typeof m.metadata_json === "string"
          ? (JSON.parse(m.metadata_json as string) as Record<string, unknown>)
          : (m.metadata_json as Record<string, unknown>);
    }
  } catch {
    meta = null;
  }
  const channel = String(m.channel || "sms");
  const isSystem =
    String(m.direction || "") === "system" || meta?.system_event === true;
  const direction: ConversationMessage["direction"] = isSystem
    ? "system"
    : channel === "internal"
      ? "internal"
      : (String(m.direction || "inbound") as ConversationMessage["direction"]);
  return {
    id: Number(m.id),
    conversation_id:
      m.conversation_id != null ? Number(m.conversation_id) : undefined,
    direction,
    channel,
    body: m.body != null ? String(m.body) : null,
    media_url: m.media_url ? String(m.media_url) : null,
    media_content_type: m.media_content_type
      ? String(m.media_content_type)
      : null,
    from_address: m.from_address != null ? String(m.from_address) : null,
    to_address: m.to_address != null ? String(m.to_address) : null,
    sent_by_admin_id:
      m.sent_by_admin_id != null ? Number(m.sent_by_admin_id) : null,
    sent_by_admin_name:
      m.sent_by_admin_name != null ? String(m.sent_by_admin_name) : null,
    provider_message_id:
      m.provider_message_id != null ? String(m.provider_message_id) : null,
    provider_status:
      m.provider_status != null ? String(m.provider_status) : null,
    error_message: m.error_message != null ? String(m.error_message) : null,
    call_duration_sec:
      m.call_duration_sec != null ? Number(m.call_duration_sec) : null,
    recording_url: m.recording_url ? String(m.recording_url) : null,
    metadata_json: meta,
    transcript:
      meta?.transcript != null && String(meta.transcript).trim()
        ? String(meta.transcript)
        : null,
    transcript_status:
      meta?.transcript_status != null
        ? String(meta.transcript_status)
        : null,
    created_at: String(m.created_at || ""),
  };
}

export const fetchConversationsAccess = createApiThunk<
  ConversationsAccessResponse,
  void
>("conversations/access", A, async () => {
  const { data } = await api.get<ConversationsAccessResponse>(
    "/admin/conversations/access",
  );
  return data;
});

export const fetchConversationsNavBadge = createApiThunk<number, void>(
  "conversations/navBadge",
  A,
  async () => {
    const { data } = await api.get<{ unread_total: number }>(
      "/admin/conversations/badge",
    );
    return Number(data.unread_total || 0);
  },
);

export const fetchConversationsAblyToken = createApiThunk<unknown | null, void>(
  "conversations/ablyToken",
  A,
  async () => {
    try {
      const { data } = await api.get<{ tokenRequest: unknown }>(
        "/admin/conversations/ably-token",
      );
      return data.tokenRequest ?? null;
    } catch {
      return null;
    }
  },
);

export type InboxQuery = {
  view?: ConversationsView;
  page?: number;
  limit?: number;
  soft?: boolean;
  append?: boolean;
  q?: string;
};

export const fetchConversationInbox = createApiThunk<
  ConversationsListResponse & { soft?: boolean; append?: boolean },
  InboxQuery | undefined
>("conversations/inbox", A, async (args) => {
  const { data } = await api.get<ConversationsListResponse>(
    "/admin/conversations",
    {
      params: {
        view: args?.view || "all",
        page: args?.page || 1,
        limit: args?.limit || PAGE_SIZE,
        q: args?.q || undefined,
      },
    },
  );
  return { ...data, soft: !!args?.soft, append: !!args?.append };
});

/** Leads matching the Conversations search box (name / email / phone). */
export const searchConversationLeads = createApiThunk<ConversationLeadMatch[], string>(
  "conversations/leadSearch",
  A,
  async (q) => {
    if (q.trim().length < 2) return [];
    const { data } = await api.get<{ leads: ConversationLeadMatch[] }>("/admin/conversations/lead-search", {
      params: { q: q.trim() },
    });
    return data.leads;
  },
);

export const fetchConversationTimeline = createApiThunk<
  ConversationTimeline,
  { kind: ConversationContactKind; id: number }
>("conversations/timeline", A, async ({ kind, id }) => {
  const { data } = await api.get<ConversationTimelineResponse>(
    `/admin/conversations/contact/${kind}/${id}/timeline`,
  );
  const rawMessages = (data.messages || []) as unknown as Record<
    string,
    unknown
  >[];
  return {
    kind: data.kind,
    contact: (data.contact || {}) as Record<string, unknown>,
    threads: (data.threads || []) as ConversationThread[],
    messages: rawMessages.map(mapMessage),
  };
});

export const sendConversationMessage = createApiThunk<
  {
    ok: boolean;
    conversation_id: number;
    message_id: number;
    client_id?: number;
    unknown_contact_id?: number;
    contact_id?: number;
  },
  {
    client_id?: number;
    unknown_contact_id?: number;
    contact_id?: number;
    channel?: "sms" | "internal";
    body: string;
    is_internal_note?: boolean;
    ofg_number_id?: number;
    media_url?: string;
    media_content_type?: string;
  }
>("conversations/send", A, async (args) => {
  const { data } = await api.post("/admin/conversations/send", args);
  return data;
});

export const startConversationOutbound = createApiThunk<
  {
    ok: boolean;
    kind: ConversationContactKind;
    client_id?: number;
    unknown_contact_id?: number;
    contact_id?: number;
    conversation_id: number;
  },
  {
    phone: string;
    body: string;
    ofg_number_id?: number;
    media_url?: string;
    media_content_type?: string;
  }
>("conversations/start", A, async (args) => {
  const { data } = await api.post("/admin/conversations/start", args);
  return data;
});

export const setConversationContactStatus = createApiThunk<
  { kind: ConversationContactKind; contactId: number; status: "open" | "closed" },
  {
    kind: ConversationContactKind;
    contactId: number;
    status: "open" | "closed";
  }
>("conversations/status", A, async (args) => {
  await api.post(
    `/admin/conversations/contact/${args.kind}/${args.contactId}/status`,
    { status: args.status },
  );
  return args;
});

export const markConversationRead = createApiThunk<
  { kind: ConversationContactKind; id: number },
  { kind: ConversationContactKind; id: number }
>("conversations/read", A, async (args) => {
  await api.post(
    `/admin/conversations/contact/${args.kind}/${args.id}/read`,
  );
  return args;
});


export const assignConversationToMe = createApiThunk<
  { clientId: number; assigned_admin_id: number | null },
  { clientId: number; assigned_admin_id?: number | null }
>("conversations/assign", A, async ({ clientId, assigned_admin_id }) => {
  const { data } = await api.post<{ ok: boolean; assigned_admin_id: number | null }>(
    `/admin/conversations/contact/client/${clientId}/assign`,
    assigned_admin_id === undefined ? {} : { assigned_admin_id },
  );
  return { clientId, assigned_admin_id: data.assigned_admin_id };
});

export const linkUnknownConversation = createApiThunk<
  { unknownId: number; client_id: number },
  { unknownId: number; client_id: number }
>("conversations/linkUnknown", A, async ({ unknownId, client_id }) => {
  await api.post(`/admin/conversations/unknown/${unknownId}/link`, {
    client_id,
  });
  return { unknownId, client_id };
});

/** Retry / start a transcript for a recorded call (Twilio Conversational Intelligence). */
export const retryCallTranscript = createApiThunk<
  { messageId: number; transcript_status: string },
  { messageId: number }
>("conversations/retryTranscript", A, async ({ messageId }) => {
  const { data } = await api.post<{ ok: boolean; transcript_status: string }>(
    `/admin/conversations/messages/${messageId}/transcribe`,
  );
  return { messageId, transcript_status: data.transcript_status };
});

export const createProspectFromUnknown = createApiThunk<
  { unknownId: number; client_id: number },
  {
    unknownId: number;
    first_name?: string;
    last_name?: string;
    email?: string;
    preferred_language?: "en" | "es";
    shared_phone_reason?: string;
  }
>("conversations/createProspect", A, async ({ unknownId, ...body }) => {
  const { data } = await api.post<{ ok: boolean; client_id: number }>(
    `/admin/conversations/unknown/${unknownId}/create-prospect`,
    body,
  );
  return { unknownId, client_id: data.client_id };
});

export const dismissUnknownConversation = createApiThunk<
  { unknownId: number },
  { unknownId: number }
>("conversations/dismissUnknown", A, async ({ unknownId }) => {
  await api.post(`/admin/conversations/unknown/${unknownId}/dismiss`);
  return { unknownId };
});

export const uploadConversationMedia = createApiThunk<
  { url: string; content_type: string; id?: string },
  { file: File }
>("conversations/uploadMedia", A, async ({ file }) => {
  const { data } = await api.post<{
    url: string;
    content_type: string;
    id?: string;
  }>("/admin/conversations/media/upload", file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": file.name || "mms",
    },
  });
  return data;
});

export const createConversationTemplate = createApiThunk<
  ConversationTemplate,
  { title: string; body_en: string; body_es?: string | null; sort_order?: number; category?: ConversationTemplateCategory }
>("conversations/createTemplate", A, async (body) => {
  const { data } = await api.post<{ template: ConversationTemplate }>(
    "/admin/conversation-templates",
    body,
  );
  return data.template;
});

export const updateConversationTemplate = createApiThunk<
  ConversationTemplate,
  {
    id: number;
    title?: string;
    body_en?: string;
    body_es?: string | null;
    is_active?: boolean;
    sort_order?: number;
    category?: ConversationTemplateCategory;
  }
>("conversations/updateTemplate", A, async ({ id, ...body }) => {
  const { data } = await api.patch<{ template: ConversationTemplate }>(
    `/admin/conversation-templates/${id}`,
    body,
  );
  return data.template;
});

export const deleteConversationTemplate = createApiThunk<
  { id: number },
  { id: number }
>("conversations/deleteTemplate", A, async ({ id }) => {
  await api.delete(`/admin/conversation-templates/${id}`);
  return { id };
});

/** Fire-and-forget usage bump when a template is inserted into a message. */
export const markConversationTemplateUsed = createApiThunk<boolean, number>(
  "conversations/templateUsed",
  A,
  async (id) => {
    await api.post(`/admin/conversation-templates/${id}/used`);
    return true;
  },
);

export const fetchConversationTemplates = createApiThunk<
  ConversationTemplate[],
  { all?: boolean } | void
>("conversations/templates", A, async (args) => {
  const { data } = await api.get<{ templates: ConversationTemplate[] }>(
    "/admin/conversation-templates",
    { params: args && args.all ? { all: "1" } : undefined },
  );
  return data.templates || [];
});

export const fetchAdminPhoneNumbers = createApiThunk<
  AdminPhoneNumber[],
  void
>("conversations/phoneNumbers", A, async () => {
  const { data } = await api.get<{ numbers: AdminPhoneNumber[] }>(
    "/admin/phone-numbers",
  );
  return data.numbers || [];
});

export const syncTwilioPhoneNumbers = createApiThunk<
  AdminPhoneNumber[],
  void
>("conversations/syncTwilio", A, async () => {
  const { data } = await api.post<{ numbers: AdminPhoneNumber[] }>(
    "/admin/phone-numbers/sync-twilio",
  );
  return data.numbers || [];
});

export const assignAdminPhoneNumber = createApiThunk<
  AdminPhoneNumber,
  { id: number; assigned_admin_id: number | null; friendly_name?: string | null }
>("conversations/assignPhone", A, async ({ id, ...body }) => {
  const { data } = await api.patch<{ number: AdminPhoneNumber }>(
    `/admin/phone-numbers/${id}`,
    body,
  );
  return data.number;
});

const conversationsSlice = createSlice({
  name: "conversations",
  initialState,
  reducers: {
    setConversationsView(state, action: PayloadAction<ConversationsView>) {
      state.view = action.payload;
    },
    setConversationsSearch(state, action: PayloadAction<string>) {
      state.search = action.payload;
    },
    selectConversationContact(
      state,
      action: PayloadAction<{ kind: ConversationContactKind; id: number } | null>,
    ) {
      if (!action.payload) {
        state.activeKind = null;
        state.activeId = null;
        state.timeline = null;
        return;
      }
      state.activeKind = action.payload.kind;
      state.activeId = action.payload.id;
      state.sendError = null;
    },
    setConversationsSendError(state, action: PayloadAction<string | null>) {
      state.sendError = action.payload;
    },
    clearConversationsInboxError(state) {
      state.inboxError = null;
    },
    pulseConversationsRealtime(state) {
      state.realtimeSeq += 1;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(searchConversationLeads.pending, (state, action) => {
      state.leadMatchesQuery = action.meta.arg;
    });
    builder.addCase(searchConversationLeads.fulfilled, (state, action) => {
      // Ignore stale responses from an older query.
      if (state.leadMatchesQuery === action.meta.arg) state.leadMatches = action.payload;
    });
    builder.addCase(searchConversationLeads.rejected, (state, action) => {
      if (state.leadMatchesQuery === action.meta.arg) state.leadMatches = [];
    });
    builder
      .addCase(fetchConversationsAccess.pending, (state) => {
        state.accessLoading = true;
      })
      .addCase(fetchConversationsAccess.fulfilled, (state, action) => {
        state.accessLoading = false;
        state.accessEnabled = action.payload.enabled;
        state.accessNumbers = action.payload.numbers || [];
      })
      .addCase(fetchConversationsAccess.rejected, (state) => {
        state.accessLoading = false;
        state.accessEnabled = false;
        state.accessNumbers = [];
      })
      .addCase(fetchConversationsNavBadge.fulfilled, (state, action) => {
        state.navBadgeUnread = action.payload;
      })
      .addCase(fetchConversationsAblyToken.pending, (state) => {
        state.ablyLoading = true;
      })
      .addCase(fetchConversationsAblyToken.fulfilled, (state, action) => {
        state.ablyLoading = false;
        state.ablyTokenRequest = action.payload;
      })
      .addCase(fetchConversationsAblyToken.rejected, (state) => {
        state.ablyLoading = false;
        state.ablyTokenRequest = null;
      })
      .addCase(fetchConversationInbox.pending, (state, action) => {
        if (action.meta.arg?.soft) {
          state.inboxRefreshing = true;
        } else {
          state.inboxLoading = true;
        }
        state.inboxError = null;
      })
      .addCase(fetchConversationInbox.fulfilled, (state, action) => {
        state.inboxLoading = false;
        state.inboxRefreshing = false;
        const next = action.payload.contacts || [];
        if (action.payload.append) {
          const seen = new Set(state.inbox.map((c) => `${c.kind}:${c.contact_id}`));
          state.inbox = [
            ...state.inbox,
            ...next.filter((c) => !seen.has(`${c.kind}:${c.contact_id}`)),
          ];
        } else {
          state.inbox = next;
        }
        state.inboxPagination = action.payload.pagination || null;
      })
      .addCase(fetchConversationInbox.rejected, (state, action) => {
        state.inboxLoading = false;
        state.inboxRefreshing = false;
        state.inboxError = action.payload || "errors.server";
      })
      .addCase(retryCallTranscript.fulfilled, (state, action) => {
        const msg = state.timeline?.messages.find((x) => x.id === action.payload.messageId);
        if (msg) msg.transcript_status = action.payload.transcript_status;
      })
      .addCase(fetchConversationTimeline.pending, (state) => {
        state.timelineLoading = true;
      })
      .addCase(fetchConversationTimeline.fulfilled, (state, action) => {
        state.timelineLoading = false;
        state.timeline = action.payload;
        const key = `${action.payload.kind}:${
          action.meta.arg.id
        }`;
        const activeKey = `${state.activeKind}:${state.activeId}`;
        if (key === activeKey) {
          state.inbox = state.inbox.map((c) =>
            c.kind === action.payload.kind && c.contact_id === action.meta.arg.id
              ? { ...c, unread_count: 0 }
              : c,
          );
        }
      })
      .addCase(fetchConversationTimeline.rejected, (state) => {
        state.timelineLoading = false;
      })
      .addCase(sendConversationMessage.pending, (state) => {
        state.sending = true;
        state.sendError = null;
      })
      .addCase(sendConversationMessage.fulfilled, (state) => {
        state.sending = false;
      })
      .addCase(sendConversationMessage.rejected, (state, action) => {
        state.sending = false;
        state.sendError = action.payload || "errors.server";
      })
      .addCase(startConversationOutbound.pending, (state) => {
        state.sending = true;
        state.sendError = null;
      })
      .addCase(startConversationOutbound.fulfilled, (state) => {
        state.sending = false;
      })
      .addCase(startConversationOutbound.rejected, (state, action) => {
        state.sending = false;
        state.sendError = action.payload || "errors.server";
      })
      .addCase(setConversationContactStatus.fulfilled, (state, action) => {
        const { kind, contactId, status } = action.payload;
        state.inbox = state.inbox.map((c) =>
          c.kind === kind && c.contact_id === contactId ? { ...c, status } : c,
        );
        if (
          state.activeKind === kind &&
          state.activeId === contactId &&
          state.timeline
        ) {
          state.timeline = {
            ...state.timeline,
            threads: state.timeline.threads.map((t) => ({ ...t, status })),
          };
        }
      })
      .addCase(fetchConversationTemplates.pending, (state) => {
        state.templatesLoading = true;
      })
      .addCase(fetchConversationTemplates.fulfilled, (state, action) => {
        state.templatesLoading = false;
        state.templates = action.payload;
      })
      .addCase(fetchConversationTemplates.rejected, (state) => {
        state.templatesLoading = false;
      })
      .addCase(fetchAdminPhoneNumbers.pending, (state) => {
        state.phoneNumbersLoading = true;
        state.phoneNumbersError = null;
      })
      .addCase(fetchAdminPhoneNumbers.fulfilled, (state, action) => {
        state.phoneNumbersLoading = false;
        state.phoneNumbers = action.payload;
      })
      .addCase(fetchAdminPhoneNumbers.rejected, (state, action) => {
        state.phoneNumbersLoading = false;
        state.phoneNumbersError = action.payload || "errors.server";
      })
      .addCase(syncTwilioPhoneNumbers.pending, (state) => {
        state.phoneMutating = true;
      })
      .addCase(syncTwilioPhoneNumbers.fulfilled, (state, action) => {
        state.phoneMutating = false;
        state.phoneNumbers = action.payload;
      })
      .addCase(syncTwilioPhoneNumbers.rejected, (state, action) => {
        state.phoneMutating = false;
        state.phoneNumbersError = action.payload || "errors.server";
      })
      .addCase(assignAdminPhoneNumber.pending, (state) => {
        state.phoneMutating = true;
      })
      .addCase(assignAdminPhoneNumber.fulfilled, (state, action) => {
        state.phoneMutating = false;
        const next = action.payload;
        state.phoneNumbers = state.phoneNumbers.map((n) =>
          n.id === next.id ? next : n,
        );
      })
      .addCase(assignAdminPhoneNumber.rejected, (state, action) => {
        state.phoneMutating = false;
        state.phoneNumbersError = action.payload || "errors.server";
      })
      .addCase(assignConversationToMe.fulfilled, (state, action) => {
        state.inbox = state.inbox.map((c) =>
          c.kind === "client" && c.contact_id === action.payload.clientId
            ? { ...c, assigned_admin_id: action.payload.assigned_admin_id }
            : c,
        );
      })
      .addCase(dismissUnknownConversation.fulfilled, (state, action) => {
        state.inbox = state.inbox.filter(
          (c) =>
            !(
              c.kind === "unknown" &&
              c.contact_id === action.payload.unknownId
            ),
        );
        if (
          state.activeKind === "unknown" &&
          state.activeId === action.payload.unknownId
        ) {
          state.activeKind = null;
          state.activeId = null;
          state.timeline = null;
        }
      })
      .addCase(linkUnknownConversation.fulfilled, (state, action) => {
        state.inbox = state.inbox.filter(
          (c) =>
            !(
              c.kind === "unknown" &&
              c.contact_id === action.payload.unknownId
            ),
        );
      })
      .addCase(createProspectFromUnknown.fulfilled, (state, action) => {
        state.inbox = state.inbox.filter(
          (c) =>
            !(
              c.kind === "unknown" &&
              c.contact_id === action.payload.unknownId
            ),
        );
      })
      .addCase(createConversationTemplate.fulfilled, (state, action) => {
        state.templates = [...state.templates, action.payload].sort(
          (a, b) => a.sort_order - b.sort_order || a.id - b.id,
        );
      })
      .addCase(updateConversationTemplate.fulfilled, (state, action) => {
        state.templates = state.templates.map((x) =>
          x.id === action.payload.id ? action.payload : x,
        );
      })
      .addCase(deleteConversationTemplate.fulfilled, (state, action) => {
        state.templates = state.templates.filter(
          (x) => x.id !== action.payload.id,
        );
      });
  },
});

export const {
  setConversationsView,
  setConversationsSearch,
  selectConversationContact,
  setConversationsSendError,
  clearConversationsInboxError,
  pulseConversationsRealtime,
} = conversationsSlice.actions;

export default conversationsSlice.reducer;
