import { useMemo } from "react";
import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import PageMeta from "@/components/PageMeta";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  resetPartnerForm,
  submitPartnerReferral,
} from "@/store/slices/contactSlice";
import { translateApiError } from "@/lib/api";

function makeSchema(t: TFunction) {
  return Yup.object({
    full_name: Yup.string()
      .trim()
      .min(2, t("validation.nameMin"))
      .required(t("validation.nameRequired")),
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .required(t("validation.emailRequired")),
    phone: Yup.string()
      .trim()
      .min(10, t("validation.phoneMin"))
      .required(t("validation.phoneRequired")),
    company: Yup.string().trim().max(200),
    notes: Yup.string().trim().max(2000),
  });
}

export default function Partners() {
  const { t, i18n } = useTranslation();
  const schema = useMemo(() => makeSchema(t), [t]);
  const dispatch = useAppDispatch();
  const { submitting, submitted, error } = useAppSelector(
    (s) => s.contact.partner,
  );

  return (
    <div className="groundwork-page">
      <PageMeta
        title={t("partners.metaTitle")}
        description={t("partners.metaDescription")}
        canonical="/partners"
      />
      <SiteHeader />
      <main id="top">
        <section className="interior-hero section-shell">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("partners.eyebrow")}
          </p>
          <h1>{t("partners.heading")}</h1>
          <p className="section-lead">{t("partners.lead")}</p>
        </section>

        <section className="paths-section section-shell partners-paths">
          <div className="paths-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("partners.pathsEyebrow")}
            </p>
            <h2>
              {t("partners.pathsTitleBefore")}
              <br />
              <em>{t("partners.pathsTitleEm")}</em>
            </h2>
            <p className="section-lead">{t("partners.lead")}</p>
          </div>
          <div className="path-grid">
            <article className="path-card path-card-gold">
              <span className="path-kicker">{t("partners.commissionTitle")}</span>
              <h3>{t("partners.commissionRange")}</h3>
              <p>{t("partners.commissionBody")}</p>
              <a className="path-link" href="#partner-form">
                {t("partners.formEyebrow")} <ArrowRight size={15} />
              </a>
            </article>
            <article className="path-card path-card-paper">
              <span className="path-kicker">{t("partners.whoTitle")}</span>
              <h3>{t("partners.whoHeadline")}</h3>
              <p>{t("partners.whoBody")}</p>
              <a className="path-link" href="#partner-form">
                {t("partners.submit")} <ArrowRight size={15} />
              </a>
            </article>
          </div>
        </section>

        <section className="form-section section-shell" id="partner-form">
          <div className="form-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("partners.formEyebrow")}
            </p>
            <h2>{t("partners.formTitle")}</h2>
            <p>{t("partners.formIntro")}</p>
          </div>
          <div className="lead-form-wrap">
            {submitted ? (
              <div className="success-state">
                <h3>{t("partners.successTitle")}</h3>
                <p>{t("partners.successBody")}</p>
                <button
                  className="text-link"
                  type="button"
                  onClick={() => dispatch(resetPartnerForm())}
                >
                  {t("form.another")}
                </button>
              </div>
            ) : (
              <Formik
                initialValues={{
                  full_name: "",
                  email: "",
                  phone: "",
                  company: "",
                  notes: "",
                }}
                validationSchema={schema}
                onSubmit={async (values) => {
                  await dispatch(
                    submitPartnerReferral({
                      full_name: values.full_name.trim(),
                      email: values.email.trim(),
                      phone: values.phone.trim(),
                      company: values.company.trim() || null,
                      notes: values.notes.trim() || null,
                      preferred_language: i18n.language?.startsWith("es")
                        ? "es"
                        : "en",
                    }),
                  );
                }}
              >
                {({ errors, touched }) => (
                  <Form className="lead-form">
                    {error ? (
                      <p className="form-error" role="alert">
                        {translateApiError(t, error)}
                      </p>
                    ) : null}
                    <label>
                      {t("form.name")}
                      <Field name="full_name" autoComplete="name" />
                      {touched.full_name && errors.full_name ? (
                        <span className="form-error">{errors.full_name}</span>
                      ) : null}
                    </label>
                    <div className="form-row">
                      <label>
                        {t("form.email")}
                        <Field name="email" type="email" autoComplete="email" />
                        {touched.email && errors.email ? (
                          <span className="form-error">{errors.email}</span>
                        ) : null}
                      </label>
                      <label>
                        {t("form.phone")}
                        <Field name="phone" type="tel" autoComplete="tel" />
                        {touched.phone && errors.phone ? (
                          <span className="form-error">{errors.phone}</span>
                        ) : null}
                      </label>
                    </div>
                    <label>
                      {t("partners.company")}
                      <Field name="company" autoComplete="organization" />
                    </label>
                    <label>
                      {t("partners.notes")}
                      <Field as="textarea" name="notes" rows={3} />
                    </label>
                    <button
                      className="button button-gold form-submit"
                      type="submit"
                      disabled={submitting}
                    >
                      {submitting
                        ? t("form.submitting")
                        : t("partners.submit")}{" "}
                      <ArrowRight size={17} />
                    </button>
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
