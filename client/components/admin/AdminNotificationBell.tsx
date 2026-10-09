import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminInbox,
  markAdminNotificationsRead,
} from "@/store/slices/adminNotificationsSlice";
import { cn } from "@/lib/cn";

function relativeLink(url: string | null): string {
  if (!url) return "/admin";
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}` || "/admin";
  } catch {
    return "/admin";
  }
}

type Props = {
  /** `embedded` sits inside the sidebar account strip (dark chrome). */
  variant?: "standalone" | "embedded";
};

type PanelPos = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

/**
 * In-app inbox UI. Live updates come from AdminRealtimeBridge (Ably);
 * opening the panel refreshes once — no interval polling.
 * Panel is portaled + fixed so sidebar overflow cannot clip it.
 */
export default function AdminNotificationBell({
  variant = "standalone",
}: Props) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { inbox, unreadCount, inboxLoading } = useAppSelector(
    (s) => s.adminNotifications,
  );
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const placePanel = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // Cap to viewport gutters so ~320px phones keep ~12px margins (Optimum pattern).
    const width = Math.min(352, Math.max(240, window.innerWidth - 24));
    const maxHeight = Math.min(352, Math.round(window.innerHeight * 0.55));
    const gap = 10;

    // Prefer opening into the main column (to the right of the bell).
    let left = rect.right + gap;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, rect.left - width - gap);
    }
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }

    // Prefer above the control; flip below if not enough room.
    const spaceAbove = rect.top - 12;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    if (spaceAbove >= Math.min(220, maxHeight) || spaceAbove >= spaceBelow) {
      setPos({
        left,
        width,
        maxHeight: Math.min(maxHeight, spaceAbove),
        bottom: window.innerHeight - rect.top + gap,
      });
    } else {
      setPos({
        left,
        width,
        maxHeight: Math.min(maxHeight, spaceBelow),
        top: rect.bottom + gap,
      });
    }
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    placePanel();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => placePanel();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const badge =
    unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : null;

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            className="gw-admin-bell-panel gw-admin-bell-panel--fixed"
            role="dialog"
            aria-label={t("admin.notifyBellTitle")}
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              ...(pos.top != null
                ? { top: pos.top }
                : { bottom: pos.bottom }),
            }}
          >
            <div className="gw-admin-bell-panel-head">
              <strong>{t("admin.notifyBellTitle")}</strong>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="gw-admin-bell-mark"
                  onClick={() => {
                    void dispatch(markAdminNotificationsRead({ all: true }));
                  }}
                >
                  {t("admin.notifyBellMarkAll")}
                </button>
              ) : null}
            </div>
            {inboxLoading && inbox.length === 0 ? (
              <p className="pf-muted gw-admin-bell-empty">{t("pf.loading")}</p>
            ) : inbox.length === 0 ? (
              <p className="pf-muted gw-admin-bell-empty">
                {t("admin.notifyBellEmpty")}
              </p>
            ) : (
              <ul className="gw-admin-bell-list">
                {inbox.map((n) => {
                  const to = relativeLink(n.link_url);
                  const unread = !n.read_at;
                  return (
                    <li key={n.id}>
                      <Link
                        to={to}
                        className={cn(
                          "gw-admin-bell-item",
                          unread && "is-unread",
                        )}
                        onClick={() => {
                          if (unread) {
                            void dispatch(
                              markAdminNotificationsRead({ ids: [n.id] }),
                            );
                          }
                          setOpen(false);
                        }}
                      >
                        <span className="gw-admin-bell-item-title">
                          {n.title}
                        </span>
                        {n.body ? (
                          <span className="gw-admin-bell-item-body">
                            {n.body}
                          </span>
                        ) : null}
                        <span className="gw-admin-bell-item-meta">
                          {t(`admin.notifyEvents.${n.event_key}`, {
                            defaultValue: n.event_key,
                          })}
                          {" · "}
                          {new Date(n.created_at).toLocaleString(i18n.language)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={cn(
        "gw-admin-bell",
        variant === "embedded" && "gw-admin-bell--embedded",
      )}
      ref={rootRef}
    >
      <button
        ref={btnRef}
        type="button"
        className={cn("gw-admin-bell-btn", open && "is-open")}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("admin.notifyBellAria", { count: unreadCount })}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void dispatch(fetchAdminInbox(20));
        }}
      >
        <Bell size={16} aria-hidden />
        {badge ? (
          <span className="gw-admin-bell-badge" aria-hidden>
            {badge}
          </span>
        ) : null}
      </button>
      {panel}
    </div>
  );
}
