import { useMemo } from "react";
import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import { ArrowRight, Mail, MapPin, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ContactIntent } from "@shared/api";
import PageMeta from "@/components/PageMeta";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetContactForm, submitContact } from "@/store/slices/contactSlice";
import { translateApiError } from "@/lib/api";
import {
  SITE_ADDRESS_LINES,
  SITE_EMAIL,
  SITE_PHONE_DISPLAY,
  SITE_PHONE_TEL,
} from "@/lib/site";

const INTENTS: ContactIntent[] = [
  "adu_project",
  "financing",
  "partner",
  "general",
];

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
    intent: Yup.string()
      .oneOf(INTENTS)
      .required(t("validation.intentRequired")),
    sms_transactional_consent: Yup.boolean().oneOf(
      [true],
      t("validation.smsTransactional"),
    ),
    sms_marketing_consent: Yup.boolean(),
  });
}

export default function Contact() {
  const { t, i18n } = useTranslation();
  const schema = useMemo(() => makeSchema(t), [t]);
  const dispatch = useAppDispatch();
  const { submitting, submitted, submittedKind, error } = useAppSelector(
    (s) => s.contact.contact,
  );

  return (
    <div className="groundwork-page">
      <PageMeta
        title={t("contact.metaTitle")}
        description={t("contact.metaDescription")}
        canonical="/contact"
      />
      <SiteHeader />
      <main id="top">
        <section className="interior-hero section-shell contact-hero">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("contact.eyebrow")}
          </p>
          <h1>{t("contact.heading")}</h1>
          <p className="section-lead">{t("contact.lead")}</p>
          <div className="event-meta contact-meta">
            <div>
              <span>
                <Phone size={12} aria-hidden /> {t("contact.metaPhone")}
              </span>
              <strong>
                <a href={`tel:${SITE_PHONE_TEL}`}>{SITE_PHONE_DISPLAY}</a>
              </strong>
            </div>
            <div>
              <span>
                <Mail size={12} aria-hidden /> {t("contact.metaEmail")}
              </span>
              <strong>
                <a href={`mailto:${SITE_EMAIL}`}>{SITE_EMAIL}</a>
              </strong>
            </div>
            <div>
              <span>
                <MapPin size={12} aria-hidden /> {t("contact.metaAddress")}
              </span>
              <strong>
                {SITE_ADDRESS_LINES.map((line, i) => (
                  <span key={line}>
                    {i > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </strong>
            </div>
          </div>
        </section>

        <section className="form-section section-shell" id="contact-form">
          <div className="form-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("contact.eyebrow")}
            </p>
            <h2>{t("contact.formTitle")}</h2>
            <p>{t("contact.formIntro")}</p>
          </div>
          <div className="lead-form-wrap">
            {submitted ? (
              <div className="success-state">
                <h3>
                  {submittedKind === "partner_affiliate"
                    ? t("contact.partnerSuccessTitle")
                    : t("contact.successTitle")}
                </h3>
                <p>
                  {submittedKind === "partner_affiliate"
                    ? t("contact.partnerSuccessBody")
                    : t("contact.successBody")}
                </p>
                <button
                  className="text-link"
                  type="button"
                  onClick={() => dispatch(resetContactForm())}
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
                  intent: "adu_project" as ContactIntent,
                  sms_transactional_consent: false,
                  sms_marketing_consent: false,
                }}
                validationSchema={schema}
                onSubmit={async (values) => {
                  await dispatch(
                    submitContact({
                      full_name: values.full_name.trim(),
                      email: values.email.trim(),
                      phone: values.phone.trim(),
                      intent: values.intent,
                      preferred_language: i18n.language?.startsWith("es")
                        ? "es"
                        : "en",
                      sms_transactional_consent:
                        values.sms_transactional_consent,
                      sms_marketing_consent: values.sms_marketing_consent,
                    }),
                  );
                }}
              >
                {({ errors, touched, values, setFieldValue }) => (
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
                      {t("contact.intent")}
                      <Field as="select" name="intent">
                        {INTENTS.map((key) => (
                          <option key={key} value={key}>
                            {t(`contact.intent_${key}`)}
                          </option>
                        ))}
                      </Field>
                      {touched.intent && errors.intent ? (
                        <span className="form-error">{errors.intent}</span>
                      ) : null}
                    </label>
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={values.sms_transactional_consent}
                        onChange={(e) =>
                          setFieldValue(
                            "sms_transactional_consent",
                            e.target.checked,
                          )
                        }
                      />
                      <span>{t("contact.smsTransactional")}</span>
                    </label>
                    {touched.sms_transactional_consent &&
                    errors.sms_transactional_consent ? (
                      <span className="form-error">
                        {errors.sms_transactional_consent}
                      </span>
                    ) : null}
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={values.sms_marketing_consent}
                        onChange={(e) =>
                          setFieldValue(
                            "sms_marketing_consent",
                            e.target.checked,
                          )
                        }
                      />
                      <span>{t("contact.smsMarketing")}</span>
                    </label>
                    <button
                      className="button button-gold form-submit"
                      type="submit"
                      disabled={submitting}
                    >
                      {submitting ? t("form.submitting") : t("contact.submit")}{" "}
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
