import { useEffect } from "react";
import { ArrowRight, Clock, Loader2 } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetLeadForm } from "@/store/slices/leadSlice";
import { clearEventDetail, fetchEventBySlug } from "@/store/slices/publicEventsSlice";
import LeadForm from "@/components/LeadForm";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PageMeta, { breadcrumbSchema } from "@/components/PageMeta";
import EventHero from "@/components/events/EventHero";
import EventMediaGallery from "@/components/events/EventMediaGallery";

/** Public event page (`/events/:slug`): upcoming → details + RSVP form; past → highlights reel + gallery. */
export default function EventDetail() {
  const { t, i18n } = useTranslation();
  const { slug = "" } = useParams();
  const dispatch = useAppDispatch();
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
  const { hash } = useLocation();

  // QR scans land on `#register` before the event loads — scroll once it renders.
  useEffect(() => {
    if (!current || hash !== "#register") return;
    const id = window.setTimeout(() => {
      document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [current, hash]);
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
              <Link className="button button-gold" to="/events">
                {t("events.seeAll")} <ArrowRight size={16} />
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

  const path = `/events/${current.slug}`;
  const cover = current.cover_url || current.image_url;

  return (
    <div className="groundwork-page">
      <PageMeta
        title={current.title}
        description={current.summary || t("event.body")}
        canonical={path}
        image={cover || undefined}
        ogType="website"
        jsonLd={[
          breadcrumbSchema([
            { name: t("brand.name"), path: "/" },
            { name: t("events.title"), path: "/events" },
            { name: current.title, path },
          ]),
        ]}
      />
      <SiteHeader />

      <main className="interior-main event-page">
        <EventHero
          event={current}
          back={{
            to: current.is_past ? "/events?tab=past" : "/events",
            label: t("events.backToEvents"),
          }}
          action={
            current.is_past ? (
              <p className="event-closed event-closed--inline" role="status">
                <Clock size={18} /> {t("events.pastNote")}
              </p>
            ) : undefined
          }
        />

        {current.is_past ? (
          <EventMediaGallery media={current.media || []} title={current.title} />
        ) : (
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
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
