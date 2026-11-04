import CityPickerField from "@/components/CityPickerField";
import { useEffect } from "react";
import TermsConsentField from "@/components/TermsConsentField";
import SmsConsentField from "@/components/SmsConsentField";
import { useLeadPrefill } from "@/hooks/useLeadPrefill";
import PartnerTypeFields, { PARTNER_TYPE_DEFAULTS, partnerTypePayload, partnerTypeSchema, type PartnerTypeValues } from "@/components/portal/PartnerTypeFields";
import { Link } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import SpamFolderHint from "@/components/SpamFolderHint";
import AuthStage from "@/components/portal/AuthStage";
import { ErrorNote, SubmitButton, TextField } from "@/components/portal/kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetAffiliateSignup, submitAffiliateSignup } from "@/store/slices/onboardingSlice";
import { yupPhoneRequired } from "@/lib/validation";

export default function AffiliateSignup() {
  const { t, i18n } = useTranslation();
  const prefill = useLeadPrefill();
  const dispatch = useAppDispatch();
  const { submitting, done, error } = useAppSelector((s) => s.onboarding.signup);

  useEffect(() => {
    dispatch(resetAffiliateSignup());
  }, [dispatch]);

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
    phone: yupPhoneRequired(t("validation.phoneMin"), t("validation.phoneRequired")),
    ...partnerTypeSchema(t),
  });

  return (
    <AuthStage
      accent="gold"
      titleKey="affSignup.title"
      leadKey="affSignup.lead"
      pointKeys={["affSignup.pointLink", "affSignup.pointTrack", "affSignup.pointPaid"]}
      canonical="/affiliate/signup"
    >
      {done ? (
        <div className="portal-login-form pf-success">
          <CheckCircle2 size={34} />
          <h2>{t("affSignup.doneTitle")}</h2>
          <p className="portal-login-hint">{t("affSignup.doneBody")}</p>
          <SpamFolderHint />
          <Link className="button button-gold form-submit" to="/">
            {t("affSignup.backHome")}
          </Link>
        </div>
      ) : (
        <Formik
          enableReinitialize
          initialValues={{
            first_name: prefill?.first_name || "",
            last_name: prefill?.last_name || "",
            email: prefill?.email || "",
            phone: prefill?.phone || "",
            ...PARTNER_TYPE_DEFAULTS,
            city_ids: [] as number[],
            sms_marketing_consent: false,
            accept_terms: false,
          }}
          validationSchema={schema}
          onSubmit={(v) =>
            dispatch(
              submitAffiliateSignup({
                first_name: v.first_name.trim(),
                last_name: v.last_name.trim(),
                email: v.email.trim(),
                phone: v.phone.trim(),
                ...partnerTypePayload(v as PartnerTypeValues),
                preferred_language: i18n.language?.startsWith("es") ? "es" : "en",
                city_ids: v.city_ids,
                sms_marketing_consent: v.sms_marketing_consent,
                accept_terms: v.accept_terms,
              }),
            )
          }
        >
          <Form className="portal-login-form pf-form">
            <h2>{t("affSignup.formTitle")}</h2>
            <p className="portal-login-hint">{t("affSignup.formHint")}</p>
            <ErrorNote error={error} />
            <div className="pf-form-grid">
              <TextField name="first_name" labelKey="form.firstName" />
              <TextField name="last_name" labelKey="form.lastName" />
            </div>
            <TextField name="email" labelKey="form.email" type="email" />
            <TextField name="phone" labelKey="form.phone" type="tel" />
            <PartnerTypeFields />
            <CityPickerField labelKey="cities.workIn" />
            <SmsConsentField />
            <TermsConsentField />
            <SubmitButton busy={submitting} labelKey="affSignup.submit" />
            <p className="portal-login-hint">
              {t("affSignup.haveAccount")}{" "}
              <Link className="text-link" to="/affiliate/login">
                {t("portalAuth.signIn")}
              </Link>
            </p>
          </Form>
        </Formik>
      )}
    </AuthStage>
  );
}
