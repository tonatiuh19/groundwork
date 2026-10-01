import { useEffect } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { adminCan, type AdminPerm, type PortalActor } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPortalMe,
  logoutPortal,
} from "@/store/slices/portalAuthSlice";
import PortalShellSkeleton from "@/components/portal/PortalShellSkeleton";

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
  const { user, bootstrapped, loadingMe } = useAppSelector(
    (s) => s.portalAuth[actor],
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

  if (!bootstrapped || loadingMe) {
    return <PortalShellSkeleton actor={actor} />;
  }

  if (!user) return null;

  const visibleNav = nav.filter((item) => {
    if (!item.perm) return true;
    const perms = Array.isArray(item.perm) ? item.perm : [item.perm];
    return perms.some((perm) => adminCan(user.role, perm));
  });

  return (
    <div className={`portal-shell portal-shell--${actor}`}>
      <aside className="portal-sidebar">
        <Link to="/" className="portal-sidebar-brand">
          <img src="/logos/groundwork-logo.png" alt="Groundwork Capital" />
        </Link>
        <p className="portal-sidebar-kicker">{t(titleKey)}</p>
        <nav className="portal-sidebar-nav" aria-label={t(titleKey)}>
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? "portal-nav-link is-active" : "portal-nav-link"
              }
            >
              <item.icon size={17} strokeWidth={1.7} />
              <span>{t(item.labelKey)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="portal-sidebar-foot">
          {actor === "admin" || actor === "affiliate" ? (
            <Link
              to={actor === "admin" ? "/admin/profile" : "/affiliate/profile"}
              className="portal-sidebar-user portal-sidebar-user--link"
              aria-label={
                actor === "admin" ? t("admin.profileNav") : t("aff.profileNav")
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
              <span className="portal-sidebar-user-copy">
                <strong>
                  {user.first_name} {user.last_name}
                </strong>
                <span>{user.email}</span>
                {user.role ? (
                  <span className="portal-role">{t(`role.${user.role}`)}</span>
                ) : null}
              </span>
            </Link>
          ) : (
            <div className="portal-sidebar-user">
              <strong>
                {user.first_name} {user.last_name}
              </strong>
              <span>{user.email}</span>
              {user.role ? (
                <span className="portal-role">{t(`role.${user.role}`)}</span>
              ) : null}
            </div>
          )}
          <button
            type="button"
            className="portal-logout"
            onClick={async () => {
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
