import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  bumpUnreadFromRealtime,
  fetchAdminInbox,
  fetchAdminNotifyAblyToken,
} from "@/store/slices/adminNotificationsSlice";
import {
  fetchConversationsNavBadge,
  pulseConversationsRealtime,
} from "@/store/slices/conversationsSlice";
import {
  closeSharedAblyClient,
  ensureSharedAblyClient,
  isAblyPermanentlyUnavailable,
  markAblyUnavailable,
  setAblyTokenFetcher,
} from "@/lib/ablyClient";
import { logger } from "@/utils/logger";

/**
 * Single admin Ably hub: notifications bell + conversations SMS/call inbox.
 * No interval API polling — refresh on Ably events, open/focus, and a slow
 * fallback poll only when Ably is permanently unavailable.
 */
const ABLY_FALLBACK_POLL_MS = 60_000;

export default function AdminRealtimeBridge() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((s) => s.portalAuth.admin.user?.id);
  const conversationsEnabled = useAppSelector(
    (s) => !!s.portalAuth.admin.user?.conversations_enabled,
  );
  const fallbackPollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) return;

    void dispatch(fetchAdminInbox(20));
    if (conversationsEnabled) {
      void dispatch(fetchConversationsNavBadge());
    }

    setAblyTokenFetcher(async () => {
      const r = await dispatch(fetchAdminNotifyAblyToken());
      if (fetchAdminNotifyAblyToken.fulfilled.match(r)) {
        return (r.payload as any) || null;
      }
      return null;
    });

    let cancelled = false;
    const unsubs: Array<() => void> = [];

    const clearFallback = () => {
      if (fallbackPollRef.current != null) {
        window.clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
    };

    const startFallbackPoll = () => {
      if (fallbackPollRef.current != null) return;
      fallbackPollRef.current = window.setInterval(() => {
        void dispatch(fetchAdminInbox(20));
        if (conversationsEnabled) {
          void dispatch(fetchConversationsNavBadge());
          dispatch(pulseConversationsRealtime());
        }
      }, ABLY_FALLBACK_POLL_MS);
    };

    /** Tab focus catch-up (not a timer). Refreshes bell + badge; pulses hub if unlocked. */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void dispatch(fetchAdminInbox(20));
      if (conversationsEnabled) {
        void dispatch(fetchConversationsNavBadge());
        dispatch(pulseConversationsRealtime());
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    (async () => {
      if (isAblyPermanentlyUnavailable()) {
        startFallbackPoll();
        return;
      }
      try {
        const client = await ensureSharedAblyClient();
        if (cancelled) return;
        if (!client) {
          startFallbackPoll();
          return;
        }

        const bellCh = client.channels.get(`admin:${userId}:notifications`);
        const onBell = () => {
          dispatch(bumpUnreadFromRealtime());
          void dispatch(fetchAdminInbox(20));
        };
        bellCh.subscribe("new", onBell);
        unsubs.push(() => {
          try {
            bellCh.unsubscribe(onBell);
          } catch {
            /* ignore */
          }
        });

        if (conversationsEnabled) {
          const convCh = client.channels.get(
            `admin:${userId}:conversations`,
          );
          const onConv = () => {
            void dispatch(fetchConversationsNavBadge());
            dispatch(pulseConversationsRealtime());
          };
          convCh.subscribe(onConv);
          unsubs.push(() => {
            try {
              convCh.unsubscribe(onConv);
            } catch {
              /* ignore */
            }
          });
        }
      } catch (e) {
        logger.warn("admin-realtime", "ably connect failed", e);
        markAblyUnavailable();
        if (!cancelled) startFallbackPoll();
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearFallback();
      for (const u of unsubs) u();
      setAblyTokenFetcher(null);
      // Keep socket open across remounts within the same SPA session;
      // close only when admin id changes (effect re-run cleans previous).
      closeSharedAblyClient();
    };
  }, [dispatch, userId, conversationsEnabled]);

  return null;
}
