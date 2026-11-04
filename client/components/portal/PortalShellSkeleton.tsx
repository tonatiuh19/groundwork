import { useTranslation } from "react-i18next";
import type { PortalActor } from "@shared/api";
import SessionCheck from "@/components/portal/SessionCheck";

const NAV_SLOTS = 7;

/** Full-shell skeleton while `/auth/me` bootstraps: sidebar chrome plus the beating logo in main. */
export default function PortalShellSkeleton({ actor }: { actor: PortalActor }) {
  const { t } = useTranslation();
  return (
    <div className={`portal-shell portal-shell--${actor} portal-shell--skeleton`}>
      <header className="portal-mobile-bar" aria-hidden>
        <div className="portal-mobile-brand">
          <img src="/logos/groundwork-logo.png" alt="" />
          <span className="portal-skel-kicker" />
        </div>
        <div className="portal-mobile-bar-actions">
          <div className="portal-skel-nav" style={{ width: "2.4rem", height: "2.4rem" }} />
        </div>
      </header>
      <aside className="portal-sidebar" aria-hidden>
        <div className="portal-sidebar-brand">
          <img src="/logos/groundwork-logo.png" alt="" />
        </div>
        <div className="portal-skel-kicker" />
        <nav className="portal-sidebar-nav">
          {Array.from({ length: NAV_SLOTS }, (_, i) => (
            <div
              key={i}
              className="portal-skel-nav"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </nav>
        <div className="portal-sidebar-foot">
          <div className="portal-skel-user">
            <div className="portal-skel-avatar" />
            <div className="portal-skel-user-copy">
              <span className="portal-skel-line portal-skel-line--name" />
              <span className="portal-skel-line portal-skel-line--email" />
            </div>
          </div>
          <div className="portal-skel-logout" />
        </div>
      </aside>
      <main className="portal-main portal-main--beat">
        <SessionCheck label={t("portalAuth.loading")} />
      </main>
    </div>
  );
}
