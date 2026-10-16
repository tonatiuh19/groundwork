import { useEffect } from "react";
import { ArrowRight, CalendarDays, Loader2, MapPin } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PublicEventView } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchEventsList, type EventsTab } from "@/store/slices/publicEventsSlice";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PageMeta, { breadcrumbSchema } from "@/components/PageMeta";
import { MediaBadge } from "@/components/events/EventMediaGallery";
import { eventDayOfMonth, useFormatters } from "@/lib/format";

function EventListCard({ event }: { event: PublicEventView }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const cover = event.cover_url || event.image_url;
  return (
    <li>
      <Link className={`events-card${event.is_past ? " events-card--past" : ""}`} to={`/events/${event.slug}`}>
        <div className="events-card-media">
          {cover ? (
            <img src={cover} alt="" loading="lazy" />
          ) : (
            <span className="calendar-mark">{eventDayOfMonth(event.starts_at)}</span>
          )}
          {event.is_past ? (
            event.media_count ? (
              <MediaBadge count={event.media_count} />
            ) : (
              <span className="event-media-badge event-media-badge--soon">{t("events.highlightsSoon")}</span>
            )
          ) : null}
        </div>
        <div className="events-card-body">
          <p className="events-card-when">
            <CalendarDays size={13} aria-hidden /> {fmt.eventDateTime(event.starts_at)}
          </p>
          <h3>{event.title}</h3>
          <p className="events-card-place">
            <MapPin size={13} aria-hidden /> {event.location_label || event.city}
          </p>
          {event.summary ? <p className="events-card-summary">{event.summary}</p> : null}
          <span className="text-link events-card-cta">
            {t(event.is_past ? "events.viewHighlights" : event.registration_open ? "events.rsvp" : "event.moreDetails")}{" "}
            <ArrowRight size={14} aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}

/** `/events` — Upcoming (soonest first, RSVP) and Past (newest first, highlights) tabs. */
export default function Events() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();
  const tab: EventsTab = params.get("tab") === "past" ? "past" : "upcoming";
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { events, loading, loaded, error } = useAppSelector((s) => s.publicEvents.list[tab]);

  useEffect(() => {
    void dispatch(fetchEventsList({ tab, lang }));
  }, [dispatch, tab, lang]);

  const tabs: EventsTab[] = ["upcoming", "past"];

  return (
    <div className="groundwork-page">
      <PageMeta
        title={t("events.metaTitle")}
        description={t("events.metaDescription")}
        canonical="/events"
        jsonLd={[
          breadcrumbSchema([
            { name: t("brand.name"), path: "/" },
            { name: t("events.title"), path: "/events" },
          ]),
        ]}
      />
      <SiteHeader />
      <main className="interior-main events-page">
        <section className="interior-hero section-shell">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("events.eyebrow")}
          </p>
          <h1>{t("events.title")}</h1>
          <p className="section-lead">{t("events.lead")}</p>
        </section>

        <section className="section-shell events-list-section">
          <div className="events-tabs" role="tablist" aria-label={t("events.tabsAria")}>
            {tabs.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`events-tab${tab === k ? " is-active" : ""}`}
                onClick={() => setParams(k === "past" ? { tab: "past" } : {}, { replace: true })}
              >
                {t(`events.tab.${k}`)}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {loading && !loaded ? (
              <p className="pf-loading">
                <Loader2 className="spin" size={16} /> {t("pf.loading")}
              </p>
            ) : error ? (
              <p className="form-error" role="alert">
                {t("errors.server")}
              </p>
            ) : events.length ? (
              <ul className="events-grid">
                {events.map((e) => (
                  <EventListCard key={e.id} event={e} />
                ))}
              </ul>
            ) : (
              <div className="events-empty">
                <CalendarDays size={28} aria-hidden />
                <h2>{t(`events.empty.${tab}`)}</h2>
                <p>{t(`events.emptyBody.${tab}`)}</p>
                {tab === "upcoming" ? (
                  <Link className="button button-gold" to="/get-credit-report">
                    {t("events.emptyCta")} <ArrowRight size={16} />
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
