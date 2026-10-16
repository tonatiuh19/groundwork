import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useEffect, useMemo } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetLeadForm } from "@/store/slices/leadSlice";
import { fetchLiveEvent } from "@/store/slices/publicEventsSlice";
import {
  clearGetCreditReportLead,
  submitGetCreditReportLead,
} from "@/store/slices/getCreditReportSlice";
import { GET_CREDIT_REPORT_URLS } from "@/lib/getCreditReportLinks";
import LeadForm from "@/components/LeadForm";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PageMeta, { breadcrumbSchema } from "@/components/PageMeta";
import EventHero from "@/components/events/EventHero";
import { translateApiError } from "@/lib/api";

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
 * `/get-credit-report` — dynamic campaign landing. While an event is live
 * (published, registration open, not past) it shows that event + RSVP with the
 * optional free soft-pull credit report below; otherwise a clean credit-report page.
 */
export default function GetCreditReport() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { event: current, loaded } = useAppSelector((s) => s.publicEvents.live);
  const {
    submitting: gcrSubmitting,
    error: gcrError,
    result: gcrResult,
  } = useAppSelector((s) => s.gcr);
  const mfsnUrl = gcrResult?.mfsn_url || GET_CREDIT_REPORT_URLS.free;
  const gcrSchema = useMemo(() => makeGcrSchema(t), [t]);

  useEffect(() => {
    void dispatch(fetchLiveEvent(lang));
  }, [dispatch, lang]);

  useEffect(() => {
    dispatch(resetLeadForm());
    return () => {
      dispatch(clearGetCreditReportLead());
    };
  }, [dispatch]);

  // Content loads async — re-scroll when #free-report is present (e.g. from /join).
  useEffect(() => {
    if (!loaded) return;
    if (location.hash !== "#free-report") return;
    const el = document.getElementById("free-report");
    if (!el) return;
    const id = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [loaded, current, location.hash]);

  if (!loaded) {
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

  return (
    <div className="groundwork-page gcr-page">
      <PageMeta
        title={current ? current.title : t("getCreditReport.metaTitle")}
        description={current?.summary || t("getCreditReport.metaDescription")}
        canonical="/get-credit-report"
        image={current?.cover_url || current?.image_url || undefined}
        ogType="website"
        noIndex
        jsonLd={[
          breadcrumbSchema([
            { name: t("brand.name"), path: "/" },
            { name: current ? current.title : t("getCreditReport.metaTitle"), path: "/get-credit-report" },
          ]),
        ]}
      />
      <SiteHeader />

      <main className="interior-main event-page">
        {current ? (
          <>
            <EventHero event={current} back={{ to: "/", label: t("getCreditReport.backHome") }} />
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
          </>
        ) : (
          <section className="interior-hero section-shell gcr-hero">
            <Link className="text-link pf-back event-back" to="/">
              <ArrowLeft size={14} /> {t("getCreditReport.backHome")}
            </Link>
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("getCreditReport.standaloneEyebrow")}
            </p>
            <h1>{t("getCreditReport.standaloneTitle")}</h1>
            <p className="section-lead">{t("getCreditReport.standaloneLead")}</p>
            <Link className="text-link" to="/events">
              <CalendarDays size={14} /> {t("getCreditReport.seeEvents")}
            </Link>
          </section>
        )}

        <section
          className="form-section section-shell gcr-optional"
          id="free-report"
        >
          <div className="form-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" />{" "}
              {t(current ? "getCreditReport.optionalEyebrow" : "getCreditReport.standaloneFormEyebrow")}
            </p>
            <h2>
              {t(current ? "getCreditReport.optionalTitleBefore" : "getCreditReport.standaloneFormBefore")}
              <br />
              <em>{t("getCreditReport.optionalTitleEm")}</em>
            </h2>
            <p>{t(current ? "getCreditReport.optionalHint" : "getCreditReport.standaloneHint")}</p>
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
