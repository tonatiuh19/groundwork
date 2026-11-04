import { useEffect } from "react";
import TermsConsentField from "@/components/TermsConsentField";
import SmsConsentField from "@/components/SmsConsentField";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import SpamFolderHint from "@/components/SpamFolderHint";
import { ArrowLeft, ArrowRight, Loader2, MailCheck } from "lucide-react";
import type { PublicAffiliateCard } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetAffiliateSignup, submitAffiliateSignup } from "@/store/slices/onboardingSlice";
import { SelectField, TextField } from "@/components/portal/kit";
import { translateApiError } from "@/lib/api";
import InvitedByCard from "./InvitedByCard";
import PartnerTypeFields, { PARTNER_TYPE_DEFAULTS, partnerTypePayload, partnerTypeSchema, type PartnerTypeValues } from "@/components/portal/PartnerTypeFields";

/** Realtor / partner path on an affiliate's link: applies as an affiliate on the inviter's team (Sponsor). */
export default function PartnerSignupForm({ affiliate, referralCode, onBack }: { affiliate: PublicAffiliateCard; referralCode: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { submitting, done, error } = useAppSelector((s) => s.onboarding.signup);
  useEffect(() => {
    dispatch(resetAffiliateSignup());
    return () => {
      dispatch(resetAffiliateSignup());
    };
  }, [dispatch]);
  const name = `${affiliate.first_name} ${affiliate.last_name}`.trim();

  if (done) {
    return (
      <div className="enroll-layout enroll-layout--done">
        <div className="enroll-panel enroll-wizard enroll-wizard--done">
          <InvitedByCard affiliate={affiliate} />
          <MailCheck size={40} className="enroll-done-icon" aria-hidden />
          <h2>{t("enrollRole.partnerDoneTitle")}</h2>
          <p>{t("enrollRole.partnerDoneBody", { name: affiliate.first_name })}</p>
          <SpamFolderHint className="enroll-done-hint" />
        </div>
      </div>
    );
  }

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
    phone: Yup.string().trim().min(10, t("validation.phoneMin")).required(t("validation.phoneRequired")),
    ...partnerTypeSchema(t),
    preferred_language: Yup.string().oneOf(["en", "es"]).required(),
  });
  return (
    <div className="enroll-layout enroll-layout--center">
      <div className="enroll-panel enroll-partner">
        <InvitedByCard affiliate={affiliate} />
        <button type="button" className="enroll-partner__back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden /> {t("enrollRole.change")}
        </button>
        <h1 className="enroll-role__title">{t("enrollRole.partnerFormTitle", { name: affiliate.first_name })}</h1>
        <p className="enroll-role__lead">{t("enrollRole.partnerFormLead", { name })}</p>
        <Formik
          initialValues={{ first_name: "", last_name: "", email: "", phone: "", ...PARTNER_TYPE_DEFAULTS, sms_marketing_consent: false, accept_terms: false, preferred_language: i18n.language?.startsWith("es") ? "es" : "en" }}
          validationSchema={schema}
          onSubmit={(v) =>
            void dispatch(
              submitAffiliateSignup({
                first_name: v.first_name.trim(),
                last_name: v.last_name.trim(),
                email: v.email.trim(),
                phone: v.phone.trim(),
                ...partnerTypePayload(v as PartnerTypeValues),
                preferred_language: v.preferred_language as "en" | "es",
                sponsor_code: referralCode,
                sms_marketing_consent: v.sms_marketing_consent,
                accept_terms: v.accept_terms,
              }),
            )
          }
        >
          <Form className="enroll-partner__form" noValidate>
            <div className="enroll-partner__row">
              <TextField name="first_name" labelKey="form.firstName" autoComplete="given-name" />
              <TextField name="last_name" labelKey="form.lastName" autoComplete="family-name" />
            </div>
            <TextField name="email" type="email" labelKey="form.email" autoComplete="email" />
            <TextField name="phone" type="tel" labelKey="form.phone" autoComplete="tel" />
            <PartnerTypeFields />
            <SelectField
              name="preferred_language"
              labelKey="enrollRole.language"
              options={[
                { value: "en", label: "English" },
                { value: "es", label: "Español" },
              ]}
            />
            <SmsConsentField />
            <TermsConsentField />
            {error ? (
              <p className="pf-error" role="alert">
                {translateApiError(t, error)}
              </p>
            ) : null}
            <button type="submit" className="button button-gold enroll-partner__submit" disabled={submitting}>
              {submitting ? <Loader2 size={16} className="spin" aria-hidden /> : null}
              {t("enrollRole.partnerSubmit")} <ArrowRight size={16} aria-hidden />
            </button>
            <p className="enroll-partner__fine">{t("enrollRole.partnerFine")}</p>
          </Form>
        </Formik>
      </div>
    </div>
  );
}
