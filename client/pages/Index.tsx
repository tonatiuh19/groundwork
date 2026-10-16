import EventQrCode from "@/components/events/EventQrCode";
import { eventQrUrl } from "@/lib/eventQr";
import { useEffect } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetLeadForm } from "@/store/slices/leadSlice";
import { fetchLiveEvent } from "@/store/slices/publicEventsSlice";
import LeadForm from "@/components/LeadForm";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import HomeMarketingSections from "@/components/HomeMarketingSections";
import AduOptionsSection from "@/components/AduOptionsSection";
import HeroCommercial from "@/components/HeroCommercial";
import PageMeta, {
  financialServiceSchema,
  organizationSchema,
  websiteSchema,
} from "@/components/PageMeta";
import { eventDayOfMonth, useFormatters } from "@/lib/format";

export default function Index() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const liveEvent = useAppSelector((s) => s.publicEvents.live.event);
  const [searchParams] = useSearchParams();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  // `?mode=standard` forces the credit-report homepage even while an event is live.
  const event = searchParams.get("mode") === "standard" ? null : liveEvent;
  const isEvent = Boolean(event);

  useEffect(() => {
    void dispatch(fetchLiveEvent(lang));
  }, [dispatch, lang]);

  // A success state from another page (e.g. /events/:slug) must not leak in here.
  useEffect(() => {
    dispatch(resetLeadForm());
  }, [dispatch]);

  return (
    <div className="groundwork-page">
      <PageMeta
        title={t("meta.title")}
        description={t("meta.description")}
        keywords={t("meta.keywords")}
        canonical="/"
        titleFull
        ogType="website"
        jsonLd={[
          organizationSchema(i18n.language?.startsWith("es") ? "es" : "en"),
          financialServiceSchema(i18n.language?.startsWith("es") ? "es" : "en"),
          websiteSchema,
        ]}
      />
      <SiteHeader />

      {event && (
        <div className="event-ribbon">
          <span className="ribbon-dot" />
          {t("ribbon.line", {
            city: event.city,
            date: fmt.eventDay(event.starts_at),
          })}
          <a href="#event-details">
            {t("ribbon.save")} <ArrowRight size={14} />
          </a>
        </div>
      )}

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("hero.eyebrow")}
            </p>
            <h1>
              {t("hero.titleBefore")}
              <br />
              <em>{t("hero.titleEm")}</em> {t("hero.titleAfter")}
            </h1>
            <p className="hero-body">{t("hero.body")}</p>
            <div className="hero-actions">
              <a
                className="button button-gold"
                href={isEvent ? "#get-started" : "/get-credit-report"}
              >
                {isEvent ? t("hero.ctaEvent") : t("hero.ctaStandard")}{" "}
                <ArrowRight size={17} />
              </a>
              <a className="text-link" href="#full-process">
                {t("hero.seeHow")} <ArrowRight size={15} />
              </a>
            </div>
            <div className="trust-line">
              <ShieldCheck size={17} /> {t("hero.trust")}
            </div>
          </div>
          <HeroCommercial />
        </section>

        <HomeMarketingSections />

        <section className="statement-section" id="why-groundwork">
          <div className="statement-rule" />
          <p className="eyebrow">{t("why.eyebrow")}</p>
          <h2>
            {t("why.titleBefore")}
            <br />
            <em>{t("why.titleEm")}</em>
          </h2>
          <p className="statement-copy">{t("why.body")}</p>
          <div className="statement-signature">
            <span /> {t("why.signature")}
          </div>
        </section>

        <section
          className="financing-explainer section-shell"
          id="adu-financing"
        >
          <div className="financing-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("financing.eyebrow")}
            </p>
            <h2>
              {t("financing.titleBefore")}
              <br />
              <em>{t("financing.titleEm")}</em>
            </h2>
            <p className="section-lead">{t("financing.lead")}</p>
            <a className="text-link financing-cta" href="#get-started">
              {t("financing.cta")} <ArrowRight size={15} />
            </a>
          </div>
          <div className="financing-steps">
            <div className="financing-step">
              <span className="financing-step-number">01</span>
              <div>
                <h3>{t("financing.step1Title")}</h3>
                <p>{t("financing.step1Body")}</p>
              </div>
            </div>
            <div className="financing-step">
              <span className="financing-step-number">02</span>
              <div>
                <h3>{t("financing.step2Title")}</h3>
                <p>{t("financing.step2Body")}</p>
              </div>
            </div>
            <div className="financing-step">
              <span className="financing-step-number">03</span>
              <div>
                <h3>{t("financing.step3Title")}</h3>
                <p>{t("financing.step3Body")}</p>
              </div>
            </div>
            <p className="financing-note">{t("financing.note")}</p>
          </div>
        </section>

        <AduOptionsSection />

        {event && (
          <section className="event-section section-shell" id="event-details">
            <div className="event-copy">
              <p className="eyebrow">
                <span className="eyebrow-line" /> {t("event.eyebrow")}
              </p>
              <h2>{event.title}</h2>
              <p>{event.summary || t("event.body")}</p>
              <div className="event-meta">
                <div>
                  <span>{t("event.date")}</span>
                  <strong>{fmt.eventDateTime(event.starts_at)}</strong>
                </div>
                <div>
                  <span>{t("event.location")}</span>
                  <strong>{event.location_label || event.city}</strong>
                </div>
              </div>
              <Link
                className="text-link event-more"
                to={`/events/${event.slug}`}
              >
                {t("event.moreDetails")} <ArrowRight size={15} />
              </Link>
            </div>
            <div className="event-card">
              <div className="event-card-top">
                <span className="calendar-mark">
                  {eventDayOfMonth(event.starts_at)}
                </span>
                <span>
                  {t("event.cardLine1")}
                  <br />
                  {t("event.cardLine2")}
                </span>
              </div>
              <EventQrCode url={eventQrUrl(event.slug)} label={t("event.qrAria")} className="event-card-qr" />
              <p>
                {t("event.scanLine1")}
                <br />
                {t("event.scanLine2")}
              </p>
              {event.spots_remaining != null ? (
                <p className="event-spots">
                  {event.spots_remaining === 0 && event.waitlist_enabled
                    ? t("event.waitlistOpen")
                    : t("event.spotsLeft", { count: event.spots_remaining })}
                </p>
              ) : null}
              <a className="button button-dark" href="#get-started">
                {event.cta || t("event.register")} <ArrowRight size={16} />
              </a>
            </div>
          </section>
        )}

        <section className="form-section section-shell" id="get-started">
          <div className="form-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("form.eyebrow")}
            </p>
            <h2>
              {isEvent ? (
                <>
                  {t("form.titleEventBefore")}
                  <br />
                  <em>{t("form.titleEventEm", { city: event?.city })}</em>
                </>
              ) : (
                <>
                  {t("form.titleStandardBefore")}
                  <br />
                  <em>{t("form.titleStandardEm")}</em>
                </>
              )}
            </h2>
            <p>{t("form.intro")}</p>
          </div>
          <div className="lead-form-wrap">
            <LeadForm event={event} />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
