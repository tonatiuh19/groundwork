import { useEffect, useId, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Lock, LogOut, MoreHorizontal, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { adminCan, type AdminPerm, type PortalActor } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPortalMe,
  logoutPortal,
} from "@/store/slices/portalAuthSlice";
import PortalShellSkeleton from "@/components/portal/PortalShellSkeleton";
import AdminNotificationBell from "@/components/admin/AdminNotificationBell";
import AdminRealtimeBridge from "@/components/admin/AdminRealtimeBridge";

export type PortalNavItem = {
  to: string;
  end?: boolean;
  labelKey: string;
  icon: LucideIcon;
  /**
   * Admin-only: hide the item unless the signed-in role has this capability.
   * An array means "any of" (e.g. events OR leads).
   */
  perm?: AdminPerm | readonly AdminPerm[];
  /**
   * Admin-only: when true and the user has no assigned brand Twilio line,
   * render a disabled lock row (no navigation) with tooltip.
   */
  requiresConversations?: boolean;
};

type Props = {
  actor: PortalActor;
  loginPath: string;
  titleKey: string;
  nav: PortalNavItem[];
  /** Extra header control (phone top bar + desktop sidebar), e.g. the affiliate "My link". */
  headerAction?: ReactNode;
  /** Replaces the page (e.g. contractor membership lock) while the shell stays usable. */
  gate?: ReactNode;
  /** Slim banner above every page (e.g. "your card expires soon"). */
  notice?: ReactNode;
  /** Phones: paths shown in the bottom tab bar (max 4, in order); everything else lives under "More". */
  tabs?: string[];
};

export default function PortalShell({
  actor,
  loginPath,
  titleKey,
  nav,
  headerAction,
  gate,
  notice,
  tabs,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const navId = useId();
  const [navOpen, setNavOpen] = useState(false);
  const { user, bootstrapped, loadingMe } = useAppSelector(
    (s) => s.portalAuth[actor],
  );
  const navBadgeUnread = useAppSelector(
    (s) => s.conversations?.navBadgeUnread ?? 0,
  );

  useEffect(() => {
    if (!bootstrapped) {
      void dispatch(fetchPortalMe(actor));
    }
  }, [actor, bootstrapped, dispatch]);

  useEffect(() => {
    if (bootstrapped && !user && !loadingMe) {
      navigate(loginPath, { replace: true });
    }
  }, [bootstrapped, user, loadingMe, navigate, loginPath]);

  // Close the drawer on route change (Optimum-style mobile shell).
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  if (!bootstrapped || loadingMe) {
    return <PortalShellSkeleton actor={actor} />;
  }

  if (!user) return null;

  const visibleNav = nav.filter((item) => {
    if (!item.perm) return true;
    const perms = Array.isArray(item.perm) ? item.perm : [item.perm];
    return perms.some((perm) => adminCan(user.role, perm));
  });

  const homePath =
    actor === "admin"
      ? "/admin"
      : actor === "affiliate"
        ? "/affiliate"
        : actor === "contractor"
          ? "/contractor"
          : "/client";

  const closeNav = () => setNavOpen(false);
  const isLocked = (item: PortalNavItem) =>
    !!item.requiresConversations && actor === "admin" && !user.conversations_enabled;
  // Phones: up to 4 primary tabs (preferred order from `tabs`, then the nav order) + "More".
  const usable = visibleNav.filter((item) => !isLocked(item));
  const tabItems = [
    ...(tabs ?? []).map((to) => usable.find((i) => i.to === to)).filter((i): i is PortalNavItem => Boolean(i)),
    ...usable.filter((i) => !(tabs ?? []).includes(i.to)),
  ].slice(0, 4);

  return (
    <div
      className={`portal-shell portal-shell--${actor}${navOpen ? " is-nav-open" : ""}`}
    >
      {actor === "admin" ? <AdminRealtimeBridge /> : null}

      <header className="portal-mobile-bar">
        <Link to={homePath} className="portal-mobile-brand" onClick={closeNav}>
          <img src="/logos/groundwork-logo.png" alt="Groundwork Capital" />
          <span className="portal-mobile-kicker">{t(titleKey)}</span>
        </Link>
        <div className="portal-mobile-bar-actions">
          {headerAction}
          {actor === "admin" ? (
            <AdminNotificationBell variant="embedded" />
          ) : null}
        </div>
      </header>

      <button
        type="button"
        className="portal-nav-overlay"
        aria-label={t("portalAuth.closeMenu")}
        tabIndex={navOpen ? 0 : -1}
        onClick={closeNav}
      />

      <aside className="portal-sidebar" id={navId} aria-label={t("portalAuth.menu")}>
        <div className="portal-sheet-head">
          <span className="portal-sheet-grip" aria-hidden />
          <strong>{t("portalAuth.menu")}</strong>
          <button type="button" className="portal-sheet-close" onClick={closeNav} aria-label={t("portalAuth.closeMenu")}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <Link to="/" className="portal-sidebar-brand" onClick={closeNav}>
          <img src="/logos/groundwork-logo.png" alt="Groundwork Capital" />
        </Link>
        <p className="portal-sidebar-kicker">{t(titleKey)}</p>
        {headerAction ? <div className="portal-sidebar-action">{headerAction}</div> : null}
        <nav className="portal-sidebar-nav" aria-label={t(titleKey)}>
          {visibleNav.map((item) => {
            const numberGated =
              !!item.requiresConversations &&
              actor === "admin" &&
              !user.conversations_enabled;

            if (numberGated) {
              const tip = t("adminNav.conversationsNumberRequired");
              return (
                <div
                  key={item.to}
                  className="portal-nav-link portal-nav-link--locked"
                  title={tip}
                  aria-disabled="true"
                >
                  <item.icon size={17} strokeWidth={1.7} />
                  <span>{t(item.labelKey)}</span>
                  <Lock
                    size={13}
                    className="portal-nav-lock-icon"
                    aria-hidden
                  />
                  <span className="portal-nav-lock-tooltip" role="tooltip">
                    {tip}
                  </span>
                </div>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={closeNav}
                className={({ isActive }) =>
                  isActive ? "portal-nav-link is-active" : "portal-nav-link"
                }
              >
                <item.icon size={17} strokeWidth={1.7} />
                <span>{t(item.labelKey)}</span>
                {item.requiresConversations && navBadgeUnread > 0 ? (
                  <span
                    className="portal-nav-badge"
                    aria-label={String(navBadgeUnread)}
                  >
                    {navBadgeUnread > 99 ? "99+" : navBadgeUnread}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="portal-sidebar-foot">
          {actor === "admin" || actor === "affiliate" ? (
            <div className="portal-account-strip">
              <Link
                to={
                  actor === "admin" ? "/admin/profile" : "/affiliate/profile"
                }
                className="portal-account-profile"
                onClick={closeNav}
                aria-label={
                  actor === "admin"
                    ? t("admin.profileNav")
                    : t("aff.profileNav")
                }
              >
                <span className="portal-sidebar-avatar" aria-hidden>
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" />
                  ) : (
                    <span>
                      {`${user.first_name?.[0] || ""}${user.last_name?.[0] || ""}`.toUpperCase() ||
                        "?"}
                    </span>
                  )}
                </span>
                <span className="portal-account-copy">
                  <strong>
                    {user.first_name} {user.last_name}
                  </strong>
                  <span className="portal-account-email">{user.email}</span>
                  {user.role ? (
                    <span className="portal-account-role">
                      {t(`role.${user.role}`)}
                    </span>
                  ) : null}
                </span>
              </Link>
              {actor === "admin" ? (
                <AdminNotificationBell variant="embedded" />
              ) : null}
            </div>
          ) : (
            <div className="portal-sidebar-user">
              <strong>
                {user.first_name} {user.last_name}
              </strong>
              <span>{user.email}</span>
              {user.role ? (
                <span className="portal-account-role">
                  {t(`role.${user.role}`)}
                </span>
              ) : null}
            </div>
          )}
          <button
            type="button"
            className="portal-logout"
            onClick={async () => {
              closeNav();
              await dispatch(logoutPortal(actor));
              navigate(loginPath);
            }}
          >
            <LogOut size={15} /> {t("portalAuth.logout")}
          </button>
        </div>
      </aside>
      <main className="portal-main">
        {gate ? null : notice}
        {gate ?? <Outlet />}
      </main>

      <nav className="portal-tabbar" aria-label={t("portalAuth.quickNav")}>
        {tabItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={closeNav}
            className={({ isActive }) => (isActive && !navOpen ? "portal-tab is-active" : "portal-tab")}
          >
            <span className="portal-tab-icon">
              <item.icon size={21} strokeWidth={1.8} aria-hidden />
              {item.requiresConversations && navBadgeUnread > 0 ? (
                <span className="portal-tab-badge">{navBadgeUnread > 99 ? "99+" : navBadgeUnread}</span>
              ) : null}
            </span>
            <span className="portal-tab-label">{t(item.labelKey)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={navOpen ? "portal-tab is-active" : "portal-tab"}
          aria-expanded={navOpen}
          aria-controls={navId}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span className="portal-tab-icon">
            <MoreHorizontal size={21} strokeWidth={1.8} aria-hidden />
          </span>
          <span className="portal-tab-label">{t("portalAuth.more")}</span>
        </button>
      </nav>
    </div>
  );
}
