import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useEffect, useMemo } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  Video,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetLeadForm } from "@/store/slices/leadSlice";
import {
  clearEventDetail,
  fetchEventBySlug,
} from "@/store/slices/publicEventsSlice";
import {
  clearGetCreditReportLead,
  submitGetCreditReportLead,
} from "@/store/slices/getCreditReportSlice";
import { GET_CREDIT_REPORT_URLS } from "@/lib/getCreditReportLinks";
import LeadForm from "@/components/LeadForm";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PageMeta, { breadcrumbSchema } from "@/components/PageMeta";
import { eventDayOfMonth, useFormatters } from "@/lib/format";
import { translateApiError } from "@/lib/api";

/** Campaign landing: Fontana RSVP lives at this URL (optional free credit report below). */
const FONTANA_EVENT_SLUG = "fontana-oct-6";

function makeGcrSchema(t: TFunction) {
  return Yup.object({
    first_name: Yup.string().trim().required(t("validation.nameRequired")),
    last_name: Yup.string().trim().required(t("validation.nameRequired")),
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .required(t("validation.emailRequired")),
    phone: Yup.string()
      .trim()
      .min(10, t("validation.phoneMin"))
      .required(t("validation.phoneRequired")),
    preferred_language: Yup.string().oneOf(["en", "es"]).required(),
    notes: Yup.string().trim().max(2000),
    soft_pull_consent: Yup.boolean().oneOf([true], t("validation.consent")),
  });
}

/**
 * `/get-credit-report` — Fontana event registration (same content/RSVP as
 * `/events/fontana-oct-6`) plus an optional free soft-pull credit report at the end.
 */
export default function GetCreditReport() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { slug: loadedSlug, event, loading, error } = useAppSelector(
    (s) => s.publicEvents.detail,
  );
  const {
    submitting: gcrSubmitting,
    error: gcrError,
    result: gcrResult,
  } = useAppSelector((s) => s.gcr);
  const mfsnUrl = gcrResult?.mfsn_url || GET_CREDIT_REPORT_URLS.free;
  const gcrSchema = useMemo(() => makeGcrSchema(t), [t]);

  useEffect(() => {
    void dispatch(fetchEventBySlug({ slug: FONTANA_EVENT_SLUG, lang }));
  }, [dispatch, lang]);

  useEffect(() => {
    dispatch(resetLeadForm());
    return () => {
      dispatch(clearEventDetail());
      dispatch(clearGetCreditReportLead());
    };
  }, [dispatch]);

  const current =
    event && loadedSlug === FONTANA_EVENT_SLUG ? event : null;
  const missing = !current && !loading && error !== null;

  if (missing) {
    return (
      <div className="groundwork-page">
        <PageMeta
          title={t("event.notFoundTitle")}
          description={t("event.notFoundBody")}
          canonical="/get-credit-report"
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
              {error && error !== "errors.eventNotFound"
                ? t("errors.server")
                : t("event.notFoundBody")}
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
        <PageMeta
          title={t("getCreditReport.metaTitle")}
          description={t("getCreditReport.metaDescription")}
          canonical="/get-credit-report"
          noIndex
        />
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

  return (
    <div className="groundwork-page gcr-page">
      <PageMeta
        title={current.title}
        description={current.summary || t("getCreditReport.metaDescription")}
        canonical="/get-credit-report"
        image={current.image_url || undefined}
        ogType="website"
        noIndex
        jsonLd={[
          breadcrumbSchema([
            { name: t("brand.name"), path: "/" },
            { name: current.title, path: "/get-credit-report" },
          ]),
        ]}
      />
      <SiteHeader />

      <main className="interior-main event-page">
        <section className="event-detail section-shell">
          <div className="event-detail-copy">
            <Link className="text-link pf-back event-back" to="/">
              <ArrowLeft size={14} /> {t("getCreditReport.backHome")}
            </Link>
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("event.eyebrow")}
            </p>
            <h1>{current.title}</h1>
            {current.summary ? (
              <p className="section-lead">{current.summary}</p>
            ) : null}

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
                  <em>
                    {[current.venue_name, current.venue_address]
                      .filter(Boolean)
                      .join(" · ")}
                  </em>
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
                      : t("event.spotsLeft", {
                          count: current.spots_remaining,
                        })}
                  </strong>
                </div>
              ) : null}
            </div>

            {current.registration_open ? (
              <a
                className="button button-gold event-detail-cta"
                href="#register"
              >
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
              <img
                className="event-detail-image"
                src={current.image_url}
                alt={current.title}
              />
            ) : (
              <div className="event-card">
                <div className="event-card-top">
                  <span className="calendar-mark">
                    {eventDayOfMonth(current.starts_at)}
                  </span>
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
            <LeadForm event={current} creditNextHref="#free-report" />
          </div>
        </section>

        <section
          className="form-section section-shell gcr-optional"
          id="free-report"
        >
          <div className="form-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("getCreditReport.optionalEyebrow")}
            </p>
            <h2>
              {t("getCreditReport.optionalTitleBefore")}
              <br />
              <em>{t("getCreditReport.optionalTitleEm")}</em>
            </h2>
            <p>{t("getCreditReport.optionalHint")}</p>
            <div className="trust-line gcr-trust">
              <ShieldCheck size={17} /> {t("getCreditReport.trust")}
            </div>
          </div>

          <div className="lead-form-wrap gcr-card-wrap">
            {gcrResult ? (
              <div className="gcr-card gcr-success">
                <div className="gcr-success-head">
                  <CheckCircle2 size={28} />
                  <div>
                    <h2>{t("getCreditReport.thanksTitle")}</h2>
                    <p>{t("getCreditReport.thanksBody")}</p>
                  </div>
                </div>
                <div className="gcr-hint">
                  <Mail size={16} />
                  <span>{t("getCreditReport.checkEmail")}</span>
                </div>
                <a
                  className="button button-gold gcr-cta"
                  href={mfsnUrl}
                  rel="noopener noreferrer"
                >
                  {t("getCreditReport.openReportNow")}{" "}
                  <ExternalLink size={16} />
                </a>
                <button
                  type="button"
                  className="text-link gcr-another"
                  onClick={() => dispatch(clearGetCreditReportLead())}
                >
                  {t("getCreditReport.submitAnother")}
                </button>
              </div>
            ) : (
              <Formik
                initialValues={{
                  first_name: "",
                  last_name: "",
                  email: "",
                  phone: "",
                  preferred_language: (lang === "es" ? "es" : "en") as
                    | "en"
                    | "es",
                  notes: "",
                  soft_pull_consent: true,
                }}
                validationSchema={gcrSchema}
                onSubmit={async (values) => {
                  await dispatch(
                    submitGetCreditReportLead({
                      first_name: values.first_name.trim(),
                      last_name: values.last_name.trim(),
                      email: values.email.trim(),
                      phone: values.phone.trim(),
                      preferred_language: values.preferred_language,
                      soft_pull_consent: values.soft_pull_consent,
                      notes: values.notes.trim() || null,
                    }),
                  );
                }}
              >
                {({ errors, touched, values, setFieldValue }) => (
                  <Form className="gcr-card lead-form">
                    <h2>{t("getCreditReport.formTitle")}</h2>
                    <p className="gcr-form-hint">
                      {t("getCreditReport.formCardHint")}
                    </p>
                    {gcrError ? (
                      <p className="form-error" role="alert">
                        {translateApiError(t, gcrError)}
                      </p>
                    ) : null}

                    <div className="form-row">
                      <label>
                        {t("getCreditReport.firstName")}
                        <Field name="first_name" autoComplete="given-name" />
                        {touched.first_name && errors.first_name ? (
                          <span className="form-error">{errors.first_name}</span>
                        ) : null}
                      </label>
                      <label>
                        {t("getCreditReport.lastName")}
                        <Field name="last_name" autoComplete="family-name" />
                        {touched.last_name && errors.last_name ? (
                          <span className="form-error">{errors.last_name}</span>
                        ) : null}
                      </label>
                    </div>

                    <label>
                      {t("getCreditReport.email")}
                      <Field name="email" type="email" autoComplete="email" />
                      {touched.email && errors.email ? (
                        <span className="form-error">{errors.email}</span>
                      ) : null}
                    </label>

                    <label>
                      {t("getCreditReport.phone")}
                      <Field name="phone" type="tel" autoComplete="tel" />
                      {touched.phone && errors.phone ? (
                        <span className="form-error">{errors.phone}</span>
                      ) : null}
                    </label>

                    <label>
                      {t("getCreditReport.language")}
                      <Field as="select" name="preferred_language">
                        <option value="en">{t("getCreditReport.langEn")}</option>
                        <option value="es">{t("getCreditReport.langEs")}</option>
                      </Field>
                    </label>

                    <label>
                      {t("getCreditReport.notes")}
                      <Field as="textarea" name="notes" rows={3} />
                    </label>

                    <label className="consent">
                      <input
                        type="checkbox"
                        name="soft_pull_consent"
                        checked={values.soft_pull_consent}
                        onChange={(e) =>
                          setFieldValue("soft_pull_consent", e.target.checked)
                        }
                      />
                      <span>{t("getCreditReport.consent")}</span>
                    </label>
                    {touched.soft_pull_consent && errors.soft_pull_consent ? (
                      <span className="form-error">
                        {errors.soft_pull_consent}
                      </span>
                    ) : null}

                    <button
                      className="button button-gold form-submit"
                      type="submit"
                      disabled={gcrSubmitting}
                    >
                      {gcrSubmitting
                        ? t("getCreditReport.submitting")
                        : t("getCreditReport.submit")}
                    </button>
                    <p className="form-note">{t("getCreditReport.note")}</p>
                  </Form>
                )}
              </Formik>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
