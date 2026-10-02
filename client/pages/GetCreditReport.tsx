import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearGetCreditReportLead,
  submitGetCreditReportLead,
} from "@/store/slices/getCreditReportSlice";
import { GET_CREDIT_REPORT_URLS } from "@/lib/getCreditReportLinks";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PageMeta, { breadcrumbSchema, webPageSchema } from "@/components/PageMeta";
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
 * Educational landing (same voice as public event pages) ending in the free
 * soft-pull credit report capture + MyFreeScoreNow handoff.
 */
export default function GetCreditReport() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { submitting, error, result } = useAppSelector((s) => s.gcr);
  const mfsnUrl = result?.mfsn_url || GET_CREDIT_REPORT_URLS.free;
  const schema = useMemo(() => makeGcrSchema(t), [t]);
  const bodyParagraphs = [
    t("getCreditReport.body1"),
    t("getCreditReport.body2"),
    t("getCreditReport.body3"),
  ].filter(Boolean);

  return (
    <div className="groundwork-page gcr-page">
      <PageMeta
        title={t("getCreditReport.metaTitle")}
        description={t("getCreditReport.metaDescription")}
        canonical="/get-credit-report"
        noIndex
        jsonLd={[
          webPageSchema({
            name: t("getCreditReport.metaTitle"),
            description: t("getCreditReport.metaDescription"),
            path: "/get-credit-report",
          }),
          breadcrumbSchema([
            { name: t("brand.name"), path: "/" },
            {
              name: t("getCreditReport.metaTitle"),
              path: "/get-credit-report",
            },
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
              <span className="eyebrow-line" /> {t("getCreditReport.eyebrow")}
            </p>
            <h1>{t("getCreditReport.heading")}</h1>
            <p className="section-lead">{t("getCreditReport.subheading")}</p>

            <div className="trust-line gcr-trust">
              <ShieldCheck size={17} /> {t("getCreditReport.trust")}
            </div>

            {!result ? (
              <a
                className="button button-gold event-detail-cta"
                href="#get-report"
              >
                {t("getCreditReport.heroCta")} <ArrowRight size={16} />
              </a>
            ) : null}
          </div>

          <aside className="event-detail-side">
            <div className="event-card gcr-side-card">
              <div className="event-card-top">
                <span className="calendar-mark gcr-side-mark" aria-hidden>
                  <ShieldCheck size={22} />
                </span>
                <span>
                  {t("getCreditReport.cardLine1")}
                  <br />
                  {t("getCreditReport.cardLine2")}
                </span>
              </div>
              <p className="event-card-place">{t("getCreditReport.cardPlace")}</p>
            </div>
          </aside>
        </section>

        {Array.isArray(bodyParagraphs) && bodyParagraphs.length ? (
          <section className="event-body section-shell" aria-label={t("getCreditReport.bodyAria")}>
            {bodyParagraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ) : null}

        <section className="form-section section-shell" id="get-report">
          <div className="form-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("getCreditReport.formEyebrow")}
            </p>
            <h2>
              {t("getCreditReport.formTitleBefore")}
              <br />
              <em>{t("getCreditReport.formTitleEm")}</em>
            </h2>
            <p>{t("getCreditReport.formHint")}</p>
          </div>

          <div className="lead-form-wrap gcr-card-wrap">
            {result ? (
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
                  preferred_language: (i18n.language?.startsWith("es")
                    ? "es"
                    : "en") as "en" | "es",
                  notes: "",
                  soft_pull_consent: true,
                }}
                validationSchema={schema}
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
                    {error ? (
                      <p className="form-error" role="alert">
                        {translateApiError(t, error)}
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
                      disabled={submitting}
                    >
                      {submitting
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
