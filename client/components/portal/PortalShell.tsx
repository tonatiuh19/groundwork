import { useEffect, useId, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Lock, LogOut, Menu, X, type LucideIcon } from "lucide-react";
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
};

export default function PortalShell({
  actor,
  loginPath,
  titleKey,
  nav,
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
          {actor === "admin" ? (
            <AdminNotificationBell variant="embedded" />
          ) : null}
          <button
            type="button"
            className="portal-menu-toggle"
            aria-expanded={navOpen}
            aria-controls={navId}
            aria-label={
              navOpen ? t("portalAuth.closeMenu") : t("portalAuth.openMenu")
            }
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? (
              <X size={20} strokeWidth={1.8} />
            ) : (
              <Menu size={20} strokeWidth={1.8} />
            )}
          </button>
        </div>
      </header>

      <button
        type="button"
        className="portal-nav-overlay"
        aria-label={t("portalAuth.closeMenu")}
        tabIndex={navOpen ? 0 : -1}
        onClick={closeNav}
      />

      <aside className="portal-sidebar" id={navId}>
        <Link to="/" className="portal-sidebar-brand" onClick={closeNav}>
          <img src="/logos/groundwork-logo.png" alt="Groundwork Capital" />
        </Link>
        <p className="portal-sidebar-kicker">{t(titleKey)}</p>
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
        <Outlet />
      </main>
    </div>
  );
}
