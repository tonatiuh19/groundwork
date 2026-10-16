import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Clock, MapPin, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PublicEventView } from "@shared/api";
import { eventDayOfMonth, useFormatters } from "@/lib/format";

/**
 * Event header block shared by `/events/:slug` and `/get-credit-report`:
 * title, date/place/online/spots, CTA (or closed / past note), cover image and body.
 */
export default function EventHero({
  event,
  back,
  action,
}: {
  event: PublicEventView;
  back: { to: string; label: string };
  /** Replaces the default RSVP CTA / closed note (e.g. past events). */
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const place = event.location_label || event.city;
  const cover = event.cover_url || event.image_url;
  const paragraphs = (event.body || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <section className="event-detail section-shell">
        <div className="event-detail-copy">
          <Link className="text-link pf-back event-back" to={back.to}>
            <ArrowLeft size={14} /> {back.label}
          </Link>
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t(event.is_past ? "events.pastEyebrow" : "event.eyebrow")}
          </p>
          <h1>{event.title}</h1>
          {event.summary ? <p className="section-lead">{event.summary}</p> : null}

          <div className="event-meta event-meta--wrap">
            <div>
              <span>
                <CalendarDays size={12} /> {t("event.date")}
              </span>
              <strong>{fmt.eventDateTime(event.starts_at)}</strong>
            </div>
            <div>
              <span>
                <MapPin size={12} /> {t("event.location")}
              </span>
              <strong>{place}</strong>
              {event.venue_name || event.venue_address ? (
                <em>{[event.venue_name, event.venue_address].filter(Boolean).join(" · ")}</em>
              ) : null}
            </div>
            {event.zoom_url && !event.is_past ? (
              <div>
                <span>
                  <Video size={12} /> {t("event.online")}
                </span>
                <a className="text-link" href={event.zoom_url} target="_blank" rel="noreferrer">
                  {t("event.joinOnline")} <ArrowRight size={13} />
                </a>
              </div>
            ) : null}
            {event.spots_remaining != null && !event.is_past ? (
              <div>
                <span>
                  <Clock size={12} /> {t("event.spots")}
                </span>
                <strong>
                  {event.spots_remaining === 0 && event.waitlist_enabled
                    ? t("event.waitlistOpen")
                    : t("event.spotsLeft", { count: event.spots_remaining })}
                </strong>
              </div>
            ) : null}
          </div>

          {action ??
            (event.registration_open ? (
              <a className="button button-gold event-detail-cta" href="#register">
                {event.cta || t("event.register")} <ArrowRight size={16} />
              </a>
            ) : (
              <p className="event-closed event-closed--inline" role="status">
                <Clock size={18} /> {t("event.registrationClosed")}
              </p>
            ))}
        </div>

        <aside className="event-detail-side">
          {cover ? (
            <img className="event-detail-image" src={cover} alt={event.title} />
          ) : (
            <div className="event-card">
              <div className="event-card-top">
                <span className="calendar-mark">{eventDayOfMonth(event.starts_at)}</span>
                <span>
                  {t("event.cardLine1")}
                  <br />
                  {t("event.cardLine2")}
                </span>
              </div>
              <p className="event-card-place">{place}</p>
            </div>
          )}
        </aside>
      </section>

      {paragraphs.length ? (
        <section className="event-body section-shell">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ) : null}
    </>
  );
}
