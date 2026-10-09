import { createSlice } from "@reduxjs/toolkit";
import type {
  AdminInAppNotification,
  AdminNotificationPrefs,
  AdminNotificationPrefsResponse,
  AdminNotifyChannel,
  AdminNotifyEventKey,
} from "@shared/api";
import { api } from "@/lib/api";
import {
  applyAdminNotifyPrefsPatch,
  type AdminNotifyPrefsPatch,
} from "@/lib/adminNotifyPrefs";
import { createApiThunk } from "@/lib/portalThunk";

type State = {
  inbox: AdminInAppNotification[];
  unreadCount: number;
  inboxLoading: boolean;
  inboxError: string | null;
  prefs: AdminNotificationPrefs | null;
  channels: AdminNotificationPrefsResponse["channels"] | null;
  events: AdminNotifyEventKey[];
  prefsLoading: boolean;
  prefsSaving: boolean;
  prefsError: string | null;
  prefsSnapshot: AdminNotificationPrefs | null;
  ablyTokenRequest: unknown | null;
};

const initialState: State = {
  inbox: [],
  unreadCount: 0,
  inboxLoading: false,
  inboxError: null,
  prefs: null,
  channels: null,
  events: [],
  prefsLoading: false,
  prefsSaving: false,
  prefsError: null,
  prefsSnapshot: null,
  ablyTokenRequest: null,
};

const A = "admin" as const;

export const fetchAdminInbox = createApiThunk(
  "adminNotifications/inbox",
  A,
  async (limit?: number) => {
    const { data } = await api.get<{
      notifications: AdminInAppNotification[];
      unread_count: number;
    }>("/admin/me/notifications", {
      params: { limit: limit ?? 20 },
    });
    return {
      notifications: data.notifications || [],
      unread_count: Number(data.unread_count || 0),
    };
  },
);

export const markAdminNotificationsRead = createApiThunk(
  "adminNotifications/markRead",
  A,
  async (body: { ids?: number[]; all?: boolean }) => {
    const { data } = await api.post<{ unread_count: number }>(
      "/admin/me/notifications/read",
      body,
    );
    return { unread_count: Number(data.unread_count || 0), ...body };
  },
);

export const fetchMyNotifyPrefs = createApiThunk(
  "adminNotifications/prefs",
  A,
  async () => {
    const { data } = await api.get<AdminNotificationPrefsResponse>(
      "/admin/me/notification-prefs",
    );
    return data;
  },
);

export const updateMyNotifyPrefs = createApiThunk<
  AdminNotificationPrefsResponse,
  AdminNotifyPrefsPatch
>("adminNotifications/updatePrefs", A, async (patch) => {
  const { data } = await api.put<AdminNotificationPrefsResponse>(
    "/admin/me/notification-prefs",
    patch,
  );
  return data;
});

export const fetchAdminNotifyAblyToken = createApiThunk(
  "adminNotifications/ablyToken",
  A,
  async () => {
    const { data } = await api.get<{ tokenRequest: unknown }>(
      "/admin/me/ably-token",
    );
    return data.tokenRequest;
  },
);

const adminNotificationsSlice = createSlice({
  name: "adminNotifications",
  initialState,
  reducers: {
    bumpUnreadFromRealtime(state) {
      state.unreadCount += 1;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchAdminInbox.pending, (s) => {
      s.inboxLoading = true;
      s.inboxError = null;
    });
    b.addCase(fetchAdminInbox.fulfilled, (s, a) => {
      s.inboxLoading = false;
      s.inbox = a.payload.notifications;
      s.unreadCount = a.payload.unread_count;
    });
    b.addCase(fetchAdminInbox.rejected, (s, a) => {
      s.inboxLoading = false;
      s.inboxError = (a.payload as string) || "errors.server";
    });

    b.addCase(markAdminNotificationsRead.fulfilled, (s, a) => {
      s.unreadCount = a.payload.unread_count;
      if (a.payload.all) {
        s.inbox = s.inbox.map((n) =>
          n.read_at ? n : { ...n, read_at: new Date().toISOString() },
        );
      } else if (a.payload.ids?.length) {
        const set = new Set(a.payload.ids);
        s.inbox = s.inbox.map((n) =>
          set.has(n.id) && !n.read_at
            ? { ...n, read_at: new Date().toISOString() }
            : n,
        );
      }
    });

    b.addCase(fetchMyNotifyPrefs.pending, (s) => {
      s.prefsLoading = true;
      s.prefsError = null;
    });
    b.addCase(fetchMyNotifyPrefs.fulfilled, (s, a) => {
      s.prefsLoading = false;
      s.prefs = a.payload.prefs;
      s.channels = a.payload.channels;
      s.events = a.payload.events || [];
    });
    b.addCase(fetchMyNotifyPrefs.rejected, (s, a) => {
      s.prefsLoading = false;
      s.prefsError = (a.payload as string) || "errors.server";
    });

    b.addCase(updateMyNotifyPrefs.pending, (s, a) => {
      s.prefsSaving = true;
      s.prefsError = null;
      if (s.prefs && !s.prefsSnapshot) {
        s.prefsSnapshot = {
          email: { ...s.prefs.email },
          in_app: { ...s.prefs.in_app },
          sms: { ...s.prefs.sms },
        };
      }
      if (s.prefs) {
        s.prefs = applyAdminNotifyPrefsPatch(s.prefs, a.meta.arg);
      }
    });
    b.addCase(updateMyNotifyPrefs.fulfilled, (s, a) => {
      s.prefsSaving = false;
      s.prefsSnapshot = null;
      s.prefs = a.payload.prefs;
      s.channels = a.payload.channels;
      s.events = a.payload.events || [];
    });
    b.addCase(updateMyNotifyPrefs.rejected, (s, a) => {
      s.prefsSaving = false;
      s.prefsError = (a.payload as string) || "errors.server";
      if (s.prefsSnapshot) {
        s.prefs = s.prefsSnapshot;
        s.prefsSnapshot = null;
      }
    });

    b.addCase(fetchAdminNotifyAblyToken.fulfilled, (s, a) => {
      s.ablyTokenRequest = a.payload;
    });
    b.addCase(fetchAdminNotifyAblyToken.rejected, (s) => {
      s.ablyTokenRequest = null;
    });
  },
});

export const { bumpUnreadFromRealtime } = adminNotificationsSlice.actions;
export default adminNotificationsSlice.reducer;

export type { AdminNotifyChannel };
