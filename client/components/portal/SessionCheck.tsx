import { useTranslation } from "react-i18next";

/**
 * Branded "checking your session" loader: the logo beats (lub-dub) inside rippling gold rings
 * while a heartbeat line draws underneath. Static under prefers-reduced-motion.
 */
export default function SessionCheck({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="gw-beat" role="status" aria-busy="true" aria-live="polite">
      <div className="gw-beat__core" aria-hidden>
        <span className="gw-beat__ring" />
        <span className="gw-beat__ring gw-beat__ring--late" />
        <span className="gw-beat__mark">
          <img src="/logos/groundwork-logo.png" alt="" />
        </span>
      </div>
      <svg className="gw-beat__ecg" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden>
        <path className="gw-beat__ecg-base" d="M0 24H240" />
        <path className="gw-beat__ecg-line" pathLength={100} d="M0 24H70l8-10 8 10h10l8-20 10 40 8-28 6 8h20l8-8 8 8H240" />
      </svg>
      <p className="gw-beat__label">
        {label ?? t("portalAuth.checkingSession")}
        <span className="gw-beat__dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </p>
    </div>
  );
}
