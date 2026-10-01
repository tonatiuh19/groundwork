import { useTranslation } from "react-i18next";
import type { PortalActor } from "@shared/api";

const NAV_SLOTS = 7;

/** Full-shell skeleton while `/auth/me` bootstraps — mirrors sidebar + main chrome. */
export default function PortalShellSkeleton({ actor }: { actor: PortalActor }) {
  const { t } = useTranslation();
  return (
    <div
      className={`portal-shell portal-shell--${actor} portal-shell--skeleton`}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="portal-skel-sr">{t("portalAuth.loading")}</p>
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
      <main className="portal-main" aria-hidden>
        <div className="portal-skel-header">
          <div className="portal-skel-eyebrow" />
          <div className="portal-skel-title" />
          <div className="portal-skel-lead" />
          <div className="portal-skel-lead portal-skel-lead--short" />
        </div>
        <div className="portal-skel-stats">
          <div className="portal-skel-stat" />
          <div className="portal-skel-stat" />
          <div className="portal-skel-stat" />
          <div className="portal-skel-stat" />
        </div>
        <div className="portal-skel-panel" />
        <div className="portal-skel-panel portal-skel-panel--short" />
      </main>
    </div>
  );
}
