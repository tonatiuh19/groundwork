import { useEffect } from "react";
import { CalendarDays, Mail, MapPin, Phone, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AffiliateEventRow, AffiliateEventRsvp } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAffiliateEvents } from "@/store/slices/affiliatePortalSlice";
import { DataTable, EmptyState, ErrorNote, Loading, PageHeader, StatusBadge } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

/**
 * Affiliate → My events: events they host (or got RSVPs for through their link) and the people
 * credited to them, with contact details so they can follow up. Other affiliates' RSVPs never show.
 */
export default function AffiliateEvents() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { events, loading, error } = useAppSelector((s) => s.affiliatePortal);
  const es = i18n.language?.startsWith("es");

  useEffect(() => {
    void dispatch(fetchAffiliateEvents());
  }, [dispatch]);

  const columns = [
    {
      key: "name",
      headerKey: "aff.eventGuest",
      render: (r: AffiliateEventRsvp) => (
        <span className="gw-aff-ev__guest">
          <strong>{r.full_name}</strong>
          {r.became_client ? <span className="pf-badge pf-badge--good">{t("aff.eventBecameClient")}</span> : null}
        </span>
      ),
    },
    {
      key: "contact",
      headerKey: "aff.eventContact",
      render: (r: AffiliateEventRsvp) => (
        <span className="gw-aff-ev__contact">
          {r.phone ? (
            <a href={`tel:${r.phone}`}>
              <Phone size={13} aria-hidden /> {r.phone}
            </a>
          ) : null}
          {r.email ? (
            <a href={`mailto:${r.email}`}>
              <Mail size={13} aria-hidden /> {r.email}
            </a>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      headerKey: "pf.status",
      render: (r: AffiliateEventRsvp) => <StatusBadge group="registrationStatus" value={r.registration_status} />,
    },
    { key: "at", headerKey: "aff.eventRegisteredOn", render: (r: AffiliateEventRsvp) => fmt.date(r.created_at) },
  ];

  const card = (e: AffiliateEventRow) => {
    const confirmed = e.rsvps.filter((r) => r.registration_status === "confirmed").length;
    const clients = e.rsvps.filter((r) => r.became_client).length;
    return (
      <section key={e.id} className="pf-card gw-aff-ev">
        <header className="gw-aff-ev__head">
          <div className="gw-aff-ev__title">
            <h3 className="pf-h3">{es ? e.title_es || e.title_en : e.title_en}</h3>
            <p className="pf-muted gw-aff-ev__meta">
              <span>
                <CalendarDays size={14} aria-hidden /> {fmt.eventDateTime(e.starts_at)}
              </span>
              {e.venue_name || e.city ? (
                <span>
                  <MapPin size={14} aria-hidden /> {[e.venue_name, e.city].filter(Boolean).join(", ")}
                </span>
              ) : null}
            </p>
          </div>
          {e.is_host ? (
            <span className="pf-badge pf-badge--gold gw-aff-ev__host">
              <Star size={12} aria-hidden /> {t("aff.eventYouHost")}
            </span>
          ) : null}
        </header>
        <p className="gw-aff-ev__stats">{t("aff.eventStats", { count: e.rsvps.length, confirmed, clients })}</p>
        <DataTable columns={columns} rows={e.rsvps} rowKey={(r) => r.id} emptyKey="aff.eventNoRsvps" />
      </section>
    );
  };

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.myEvents" leadKey="aff.eventsLead" />
      <ErrorNote error={error} />
      {loading && !events.length ? <Loading /> : !events.length ? <EmptyState messageKey="aff.noEvents" /> : <div className="gw-aff-ev__list">{events.map(card)}</div>}
    </div>
  );
}
