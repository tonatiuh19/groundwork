import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, MapPin, UserRound, Video } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAffiliateAppointments, fetchContractorAppointments } from "@/store/slices/schedulerSlice";
import { EmptyState, Loading, PageHeader, StatusBadge } from "@/components/portal/kit";
import { formatApptRange } from "@/lib/apptTime";
import { cn } from "@/lib/cn";

/** Contractor portal → Appointments (where they're tagged: time, place, homeowner). */
export function ContractorAppointmentsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const dispatch = useAppDispatch();
  const { portal, portalLoading } = useAppSelector((s) => s.scheduler);
  useEffect(() => {
    void dispatch(fetchContractorAppointments());
  }, [dispatch]);
  const now = Date.now();
  const upcoming = portal.filter((a) => new Date(a.ends_at).getTime() >= now);
  return (
    <div className="portal-page">
      <PageHeader titleKey="appt.portalTitle" leadKey="appt.portalLead" />
      {portalLoading && !portal.length ? <Loading /> : null}
      {!portalLoading && !upcoming.length ? <EmptyState messageKey="appt.noneUpcoming" /> : null}
      <ul className="gw-appt-list">
        {upcoming.map((a) => (
          <li key={a.id}>
            <div className={cn("gw-appt-item", a.status === "cancelled" && "is-cancelled")}>
              <span className={cn("gw-appt-item__dot", `is-${a.kind}`)} aria-hidden />
              <span className="gw-appt-item__main">
                <strong>{a.title}</strong>
                <span>{formatApptRange(a.starts_at, a.ends_at, a.timezone, lang)}</span>
                {a.location ? (
                  <a className="gw-appt-item__meta" href={`https://maps.google.com/?q=${encodeURIComponent(a.location)}`} target="_blank" rel="noreferrer">
                    <MapPin size={12} aria-hidden /> {a.location}
                  </a>
                ) : null}
                {a.location_type === "video" && a.video_url ? (
                  <a className="gw-appt-item__meta" href={a.video_url} target="_blank" rel="noreferrer">
                    <Video size={12} aria-hidden /> {t("manage.join")}
                  </a>
                ) : null}
                {a.client_name ? (
                  <span className="gw-appt-item__meta">
                    <UserRound size={12} aria-hidden /> {a.client_name}
                  </span>
                ) : null}
                {a.description ? <span className="gw-appt-item__desc">{a.description}</span> : null}
              </span>
              {a.status !== "scheduled" ? <StatusBadge group="appt.status" value={a.status} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Affiliate dashboard card: upcoming appointments for referred clients (time + type). */
export function AffiliateAppointmentsCard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const dispatch = useAppDispatch();
  const list = useAppSelector((s) => s.scheduler.affiliate);
  useEffect(() => {
    void dispatch(fetchAffiliateAppointments());
  }, [dispatch]);
  const upcoming = list.filter((a) => new Date(a.ends_at).getTime() >= Date.now() && a.status === "scheduled").slice(0, 6);
  if (!upcoming.length) return null;
  return (
    <section className="pf-section gw-appt-panel">
      <h2 className="pf-h2">
        <CalendarClock size={17} aria-hidden /> {t("appt.affiliateTitle")}
      </h2>
      <ul className="gw-appt-list">
        {upcoming.map((a) => (
          <li key={a.id}>
            <div className="gw-appt-item">
              <span className={cn("gw-appt-item__dot", `is-${a.kind}`)} aria-hidden />
              <span className="gw-appt-item__main">
                <strong>
                  {t(`appt.kind.${a.kind}`)} · {a.client_name}
                </strong>
                <span>{formatApptRange(a.starts_at, a.ends_at, a.timezone, lang)}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
