import { useEffect } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Clock, Loader2, MapPin, Video } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetLeadForm } from "@/store/slices/leadSlice";
import { clearEventDetail, fetchEventBySlug } from "@/store/slices/publicEventsSlice";
import LeadForm from "@/components/LeadForm";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PageMeta, { breadcrumbSchema } from "@/components/PageMeta";
import { eventDayOfMonth, useFormatters } from "@/lib/format";

/** Public event page (`/events/:slug`): details + the same RSVP form as the homepage. */
export default function EventDetail() {
  const { t, i18n } = useTranslation();
  const { slug = "" } = useParams();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { slug: loadedSlug, event, loading, error } = useAppSelector(
    (s) => s.publicEvents.detail,
  );

  useEffect(() => {
    if (!slug) return;
    void dispatch(fetchEventBySlug({ slug, lang }));
  }, [dispatch, slug, lang]);

  useEffect(() => {
    dispatch(resetLeadForm());
    return () => {
      dispatch(clearEventDetail());
    };
  }, [dispatch, slug]);

  const current = event && loadedSlug === slug ? event : null;
  const missing = !current && !loading && (error !== null || !slug);

  if (missing) {
    return (
      <div className="groundwork-page">
        <PageMeta
          title={t("event.notFoundTitle")}
          description={t("event.notFoundBody")}
          noIndex
        />
        <SiteHeader />
        <main className="interior-main">
          <section className="interior-hero section-shell event-empty">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("event.eyebrow")}
            </p>
            <h1>{t("event.notFoundTitle")}</h1>
            <p className="section-lead">
              {error && error !== "errors.eventNotFound" ? t("errors.server") : t("event.notFoundBody")}
            </p>
            <p className="event-empty-actions">
              <Link className="button button-gold" to="/">
                {t("notFound.home")} <ArrowRight size={16} />
              </Link>
            </p>
          </section>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="groundwork-page">
        <SiteHeader />
        <main className="interior-main">
          <p className="pf-loading event-loading">
            <Loader2 className="spin" size={16} /> {t("pf.loading")}
          </p>
        </main>
      </div>
    );
  }

  const paragraphs = (current.body || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const place = current.location_label || current.city;
  const path = `/events/${current.slug}`;

  return (
    <div className="groundwork-page">
      <PageMeta
        title={current.title}
        description={current.summary || t("event.body")}
        canonical={path}
        image={current.image_url || undefined}
        ogType="website"
        jsonLd={[
          breadcrumbSchema([
            { name: t("brand.name"), path: "/" },
            { name: current.title, path },
          ]),
        ]}
      />
      <SiteHeader />

      <main className="interior-main event-page">
        <section className="event-detail section-shell">
          <div className="event-detail-copy">
            <Link className="text-link pf-back event-back" to="/">
              <ArrowLeft size={14} /> {t("event.backHome")}
            </Link>
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("event.eyebrow")}
            </p>
            <h1>{current.title}</h1>
            {current.summary ? <p className="section-lead">{current.summary}</p> : null}

            <div className="event-meta event-meta--wrap">
              <div>
                <span>
                  <CalendarDays size={12} /> {t("event.date")}
                </span>
                <strong>{fmt.eventDateTime(current.starts_at)}</strong>
              </div>
              <div>
                <span>
                  <MapPin size={12} /> {t("event.location")}
                </span>
                <strong>{place}</strong>
                {current.venue_name || current.venue_address ? (
                  <em>{[current.venue_name, current.venue_address].filter(Boolean).join(" · ")}</em>
                ) : null}
              </div>
              {current.zoom_url ? (
                <div>
                  <span>
                    <Video size={12} /> {t("event.online")}
                  </span>
                  <a
                    className="text-link"
                    href={current.zoom_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("event.joinOnline")} <ArrowRight size={13} />
                  </a>
                </div>
              ) : null}
              {current.spots_remaining != null ? (
                <div>
                  <span>
                    <Clock size={12} /> {t("event.spots")}
                  </span>
                  <strong>
                    {current.spots_remaining === 0 && current.waitlist_enabled
                      ? t("event.waitlistOpen")
                      : t("event.spotsLeft", { count: current.spots_remaining })}
                  </strong>
                </div>
              ) : null}
            </div>

            {current.registration_open ? (
              <a className="button button-gold event-detail-cta" href="#register">
                {current.cta || t("event.register")} <ArrowRight size={16} />
              </a>
            ) : (
              <p className="event-closed event-closed--inline" role="status">
                <Clock size={18} /> {t("event.registrationClosed")}
              </p>
            )}
          </div>

          <aside className="event-detail-side">
            {current.image_url ? (
              <img className="event-detail-image" src={current.image_url} alt={current.title} />
            ) : (
              <div className="event-card">
                <div className="event-card-top">
                  <span className="calendar-mark">{eventDayOfMonth(current.starts_at)}</span>
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

        <section className="form-section section-shell" id="register">
          <div className="form-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("form.eyebrow")}
            </p>
            <h2>
              {t("form.titleEventBefore")}
              <br />
              <em>{t("form.titleEventEm", { city: current.city })}</em>
            </h2>
            <p>{t("form.intro")}</p>
          </div>
          <div className="lead-form-wrap">
            <LeadForm event={current} />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
