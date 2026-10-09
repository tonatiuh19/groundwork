import { useMemo } from "react";
import { ArrowRight, Check, Clock } from "lucide-react";
import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { PublicEventView } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetLeadForm, submitLead } from "@/store/slices/leadSlice";
import { translateApiError } from "@/lib/api";

function makeLeadSchema(t: TFunction, isEvent: boolean) {
  return Yup.object({
    full_name: Yup.string()
      .trim()
      .min(2, t("validation.nameMin"))
      .required(t("validation.nameRequired")),
    phone: Yup.string()
      .trim()
      .min(10, t("validation.phoneMin"))
      .required(t("validation.phoneRequired")),
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .required(t("validation.emailRequired")),
    property_address: Yup.string()
      .trim()
      .min(5, t("validation.addressMin"))
      .required(t("validation.addressRequired")),
    // Event RSVPs never ask for a soft pull — the credit report is a separate next step.
    soft_pull_consent: isEvent
      ? Yup.boolean()
      : Yup.boolean().oneOf([true], t("validation.consent")),
  });
}

const isInternalPath = (url: string) => url.startsWith("/") && !url.startsWith("//");

/** The API returns an absolute URL; same-origin ones become in-app links. */
function normalizeCtaUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin === window.location.origin) return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    /* fall through to the raw value */
  }
  return url;
}

/**
 * Homepage / event-page lead form. With `event` it is an RSVP (mode=event, no
 * soft-pull consent, optional waitlist); without it, the standard soft-pull lead.
 * `creditNextHref` overrides the post-RSVP free-report CTA (e.g. `#free-report`
 * when this form is already on `/get-credit-report`).
 */
export default function LeadForm({
  event,
  creditNextHref,
}: {
  event?: PublicEventView | null;
  creditNextHref?: string;
}) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { submitting, submitted, error, eventRegistrationStatus, creditCtaUrl } =
    useAppSelector((s) => s.lead);
  const isEvent = Boolean(event);
  const schema = useMemo(() => makeLeadSchema(t, isEvent), [t, isEvent]);

  if (submitted) {
    if (isEvent) {
      const waitlisted = eventRegistrationStatus === "waitlisted";
      const rawNext = creditNextHref || creditCtaUrl || "/get-credit-report";
      const next = rawNext.startsWith("#")
        ? rawNext
        : normalizeCtaUrl(rawNext);
      const hashOnly = next.startsWith("#");
      return (
        <div className="success-state" data-status={waitlisted ? "waitlisted" : "confirmed"}>
          <span className="success-icon">
            {waitlisted ? <Clock size={24} /> : <Check size={24} />}
          </span>
          <h3>{waitlisted ? t("event.waitlistedThanks") : t("event.confirmedThanks")}</h3>
          <p>{waitlisted ? t("event.waitlistedBody") : t("event.confirmedBody")}</p>
          <p className="success-email-note">{t("form.successEmail")}</p>
          <p className="success-credit-hint">{t("event.creditNextHint")}</p>
          {hashOnly || !isInternalPath(next) ? (
            <a
              className="button button-gold"
              href={next}
              {...(hashOnly
                ? {}
                : { target: "_blank", rel: "noreferrer" })}
            >
              {t("event.creditNext")} <ArrowRight size={16} />
            </a>
          ) : (
            <Link className="button button-gold" to={next}>
              {t("event.creditNext")} <ArrowRight size={16} />
            </Link>
          )}
          <button
            className="text-link"
            type="button"
            onClick={() => dispatch(resetLeadForm())}
          >
            {t("form.another")}
          </button>
        </div>
      );
    }
    return (
      <div className="success-state">
        <span className="success-icon">
          <Check size={24} />
        </span>
        <h3>{t("form.successTitle")}</h3>
        <p>{t("form.successBody")}</p>
        <p className="success-email-note">{t("form.successEmail")}</p>
        <button className="text-link" type="button" onClick={() => dispatch(resetLeadForm())}>
          {t("form.another")}
        </button>
      </div>
    );
  }

  if (event && !event.registration_open) {
    return (
      <div className="event-closed" role="status">
        <Clock size={20} />
        <p>{t("event.registrationClosed")}</p>
      </div>
    );
  }

  const waitlistOnly =
    Boolean(event) && event?.spots_remaining === 0 && Boolean(event?.waitlist_enabled);

  return (
    <Formik
      initialValues={{
        full_name: "",
        phone: "",
        email: "",
        property_address: "",
        soft_pull_consent: true,
        sms_marketing_consent: false,
      }}
      validationSchema={schema}
      onSubmit={async (values) => {
        await dispatch(
          submitLead({
            full_name: values.full_name,
            phone: values.phone,
            email: values.email,
            property_address: values.property_address,
            // Not collected for events; the credit report is a separate CTA.
            soft_pull_consent: event ? false : values.soft_pull_consent,
            sms_marketing_consent: values.sms_marketing_consent,
            preferred_language: i18n.language?.startsWith("es") ? "es" : "en",
            mode: event ? "event" : "standard",
            event_id: event ? event.id : null,
            event_city: event ? event.city : null,
            source: "website",
          }),
        );
      }}
    >
      {({ errors, touched, values, setFieldValue }) => (
        <Form className="lead-form">
          {waitlistOnly ? (
            <p className="event-waitlist-note" role="status">
              <Clock size={14} /> {t("event.waitlistNotice")}
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {translateApiError(t, error)}
            </p>
          ) : null}
          <div className="form-row">
            <label>
              {t("form.name")}
              <Field name="full_name" autoComplete="name" placeholder={t("form.namePh")} />
              {touched.full_name && errors.full_name ? (
                <span className="form-error">{errors.full_name}</span>
              ) : null}
            </label>
            <label>
              {t("form.phone")}
              <Field
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder={t("form.phonePh")}
              />
              {touched.phone && errors.phone ? (
                <span className="form-error">{errors.phone}</span>
              ) : null}
            </label>
          </div>
          <label>
            {t("form.email")}
            <Field
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t("form.emailPh")}
            />
            {touched.email && errors.email ? (
              <span className="form-error">{errors.email}</span>
            ) : null}
          </label>
          <label>
            {t("form.address")}
            <Field
              name="property_address"
              autoComplete="street-address"
              placeholder={t("form.addressPh")}
            />
            {touched.property_address && errors.property_address ? (
              <span className="form-error">{errors.property_address}</span>
            ) : null}
          </label>
          {!isEvent ? (
            <>
              <label className="consent">
                <input
                  type="checkbox"
                  name="soft_pull_consent"
                  checked={values.soft_pull_consent}
                  onChange={(e) => setFieldValue("soft_pull_consent", e.target.checked)}
                />
                <span>{t("form.consent")}</span>
              </label>
              {touched.soft_pull_consent && errors.soft_pull_consent ? (
                <span className="form-error">{errors.soft_pull_consent}</span>
              ) : null}
            </>
          ) : null}
          <label className="consent">
            <input
              type="checkbox"
              name="sms_marketing_consent"
              checked={values.sms_marketing_consent}
              onChange={(e) =>
                setFieldValue("sms_marketing_consent", e.target.checked)
              }
            />
            <span>{t("form.smsMarketingConsent")}</span>
          </label>
          <button className="button button-gold form-submit" type="submit" disabled={submitting}>
            {submitting
              ? t("form.submitting")
              : isEvent
                ? waitlistOnly
                  ? t("event.joinWaitlist")
                  : event?.cta || t("form.submitEvent")
                : t("form.submitStandard")}{" "}
            <ArrowRight size={17} />
          </button>
          <p className="form-note">{isEvent ? t("form.noteEvent") : t("form.note")}</p>
        </Form>
      )}
    </Formik>
  );
}
