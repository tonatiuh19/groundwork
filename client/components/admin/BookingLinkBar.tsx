import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, Copy, ExternalLink, Link2, Settings2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchMyScheduler } from "@/store/slices/schedulerSlice";
import { cn } from "@/lib/cn";
import { logger } from "@/utils/logger";

/**
 * Calendar page: my public booking link at a glance (on / off, copy, open, the extra call-type links)
 * with a one-line helper on where to share it, and a shortcut to its settings on my profile.
 */
export default function BookingLinkBar() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const mine = useAppSelector((s) => s.scheduler.mine);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!mine) void dispatch(fetchMyScheduler());
  }, [dispatch, mine]);
  if (!mine) return null;
  const on = mine.settings.is_enabled;
  const links = [
    { key: "homeowner", url: mine.booking_url },
    ...(["affiliate", "contractor"] as const)
      .filter((k) => mine.settings.booking_types?.[k]?.enabled)
      .map((k) => ({ key: k, url: `${mine.booking_url}?type=${k}` })),
  ];
  const copy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch (e) {
      logger.warn("bookingLinkBar", e);
    }
  };
  return (
    <section className={cn("gw-booklink-bar", !on && "is-off")} aria-label={t("booking.adminTitle")}>
      <div className="gw-booklink-bar__head">
        <span className="gw-booklink-bar__icon" aria-hidden>
          <Link2 size={18} />
        </span>
        <div className="gw-booklink-bar__text">
          <strong>
            {t("booking.adminTitle")}{" "}
            <span className={cn("gw-booklink-bar__status", on ? "is-on" : "is-off")}>{on ? t("booking.on") : t("booking.off")}</span>
          </strong>
          <p>{on ? t("booking.barHelpOn") : t("booking.barHelpOff")}</p>
        </div>
        <Link className="pf-btn pf-btn--sm gw-booklink-bar__settings" to="/admin/profile#booking-link">
          <Settings2 size={14} aria-hidden /> {on ? t("booking.barSettings") : t("booking.barTurnOn")}
        </Link>
      </div>
      {on ? (
        <ul className="gw-booklink-bar__links">
          {links.map((l) => (
            <li key={l.key}>
              <span className="gw-booklink-bar__label">{t(`booking.typeFor_${l.key}`)}</span>
              <code title={l.url}>{l.url.replace(/^https?:\/\//, "")}</code>
              <span className="gw-booklink-bar__actions">
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => void copy(l.key, l.url)}>
                  {copied === l.key ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied === l.key ? t("booking.copied") : t("booking.copy")}
                </button>
                <a className="pf-btn pf-btn--sm" href={l.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} aria-hidden /> {t("booking.preview")}
                </a>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
