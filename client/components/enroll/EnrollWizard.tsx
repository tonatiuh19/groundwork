import { useEffect, useMemo, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Home,
  LayoutTemplate,
  Loader2,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { PublicAffiliateCard } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPublicPlans } from "@/store/slices/affiliatePortalSlice";
import { resetEnrollForm, submitEnroll } from "@/store/slices/enrollSlice";
import { CheckField, SelectField, TextField } from "@/components/portal/kit";
import { translateApiError } from "@/lib/api";

export const ENROLL_STEP_COUNT = 4;

const STEP_ICONS: LucideIcon[] = [User, Home, LayoutTemplate, ShieldCheck];

function makeSchema(t: TFunction, step: number) {
  const base = {
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .required(t("validation.emailRequired")),
    phone: Yup.string()
      .trim()
      .min(10, t("validation.phoneMin"))
      .required(t("validation.phoneRequired")),
    property_address: Yup.string()
      .trim()
      .min(5, t("validation.addressRequired"))
      .required(t("validation.addressRequired")),
    property_city: Yup.string().trim(),
    property_zip: Yup.string().trim(),
    adu_plan_id: Yup.string(),
    preferred_language: Yup.string().oneOf(["en", "es"]).required(),
    soft_pull_consent: Yup.boolean(),
    homeowner_consent: Yup.boolean().oneOf([true], t("validation.homeownerConsent")),
  };
  if (step === 0) {
    return Yup.object({
      first_name: base.first_name,
      last_name: base.last_name,
      email: base.email,
      phone: base.phone,
    });
  }
  if (step === 1) {
    return Yup.object({
      property_address: base.property_address,
      property_city: base.property_city,
      property_zip: base.property_zip,
    });
  }
  if (step === 2) {
    return Yup.object({
      adu_plan_id: base.adu_plan_id,
      preferred_language: base.preferred_language,
    });
  }
  return Yup.object({
    soft_pull_consent: base.soft_pull_consent,
    homeowner_consent: base.homeowner_consent,
  });
}

type Props = {
  referralCode?: string | null;
  affiliate?: PublicAffiliateCard | null;
  leadKey?: string;
};

export default function EnrollWizard({
  referralCode,
  affiliate,
  leadKey = "enroll.lead",
}: Props) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { plans } = useAppSelector((s) => s.affiliatePortal);
  const { submitting, done, projectId, error } = useAppSelector((s) => s.enroll.enroll);
  const [step, setStep] = useState(0);
  const schema = useMemo(() => makeSchema(t, step), [t, step]);
  const showDevFill =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

  useEffect(() => {
    void dispatch(fetchPublicPlans());
    return () => {
      dispatch(resetEnrollForm());
    };
  }, [dispatch]);

  if (done) {
    return (
      <div className="enroll-layout enroll-layout--done">
        <div className="enroll-panel enroll-wizard enroll-wizard--done">
          <CheckCircle2 size={40} className="enroll-done-icon" aria-hidden />
          <h2>{t("enroll.doneTitle")}</h2>
          <p>{t("enroll.doneBody")}</p>
          {projectId ? (
            <p className="enroll-done-id">{t("enroll.doneProject", { id: projectId })}</p>
          ) : null}
          <p className="enroll-done-hint">{t("enroll.doneInvite")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enroll-layout">
      <aside className="enroll-rail" aria-label={t("enroll.stepsAria")}>
        <p className="enroll-rail-kicker">{t("enroll.stepsKicker")}</p>
        <p className="enroll-rail-hint">{t("enroll.stepsHint")}</p>
        <ol className="enroll-rail-list">
          {STEP_ICONS.map((Icon, i) => {
            const state =
              i === step ? "is-current" : i < step ? "is-done" : "is-todo";
            return (
              <li key={i} className={`enroll-rail-item ${state}`}>
                <span className="enroll-rail-icon" aria-hidden>
                  <Icon size={16} />
                </span>
                <span className="enroll-rail-label">{t(`enroll.step${i}Title`)}</span>
              </li>
            );
          })}
        </ol>
        {affiliate ? (
          <div className="enroll-rail-affiliate">
            {affiliate.avatar_url ? (
              <img
                className="enroll-rail-avatar"
                src={affiliate.avatar_url}
                alt=""
              />
            ) : (
              <div className="enroll-rail-avatar enroll-rail-avatar--fallback" aria-hidden>
                {affiliate.initials}
              </div>
            )}
            <div>
              <p className="enroll-rail-aff-kicker">{t("enroll.referralKicker")}</p>
              <p className="enroll-rail-aff-name">
                {affiliate.first_name} {affiliate.last_name}
              </p>
              {affiliate.bio ? (
                <p className="enroll-rail-aff-bio">{affiliate.bio}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </aside>

      <div className="enroll-stage">
        <p className="enroll-pill">{t("enroll.stepOf", { current: step + 1, total: ENROLL_STEP_COUNT })}</p>
        <h1 className="enroll-stage-title">{t(`enroll.step${step}Title`)}</h1>
        <p className="enroll-stage-lead">{t(leadKey)}</p>

        <div className="enroll-panel">
          <Formik
            initialValues={{
              first_name: "",
              last_name: "",
              email: "",
              phone: "",
              property_address: "",
              property_city: "",
              property_zip: "",
              adu_plan_id: "",
              preferred_language: i18n.language?.startsWith("es") ? "es" : "en",
              soft_pull_consent: false,
              homeowner_consent: false,
            }}
            validationSchema={schema}
            validateOnChange={false}
            validateOnBlur
            onSubmit={async (values, helpers) => {
              if (step < ENROLL_STEP_COUNT - 1) {
                setStep((s) => s + 1);
                helpers.setTouched({});
                return;
              }
              const result = await dispatch(
                submitEnroll({
                  first_name: values.first_name.trim(),
                  last_name: values.last_name.trim(),
                  email: values.email.trim(),
                  phone: values.phone.trim(),
                  property_address: values.property_address.trim(),
                  property_city: values.property_city.trim() || null,
                  property_zip: values.property_zip.trim() || null,
                  adu_plan_id: values.adu_plan_id ? Number(values.adu_plan_id) : null,
                  preferred_language: values.preferred_language as "en" | "es",
                  soft_pull_consent: values.soft_pull_consent || undefined,
                  homeowner_consent: values.homeowner_consent,
                  referral_code: referralCode || null,
                }),
              );
              if (submitEnroll.rejected.match(result)) {
                helpers.setSubmitting(false);
              }
            }}
          >
            {({ isSubmitting, setValues }) => (
              <Form className="enroll-form">
                {showDevFill ? (
                  <button
                    type="button"
                    className="enroll-dev-fill"
                    onClick={() => {
                      const stamp = Date.now().toString(36).slice(-6);
                      setValues({
                        first_name: "Maya",
                        last_name: "Tester",
                        email: `enroll.dev.${stamp}@example.com`,
                        phone: "9495550148",
                        property_address: "123 Test ADU Lane",
                        property_city: "Fontana",
                        property_zip: "92335",
                        adu_plan_id: plans[0] ? String(plans[0].id) : "",
                        preferred_language: i18n.language?.startsWith("es")
                          ? "es"
                          : "en",
                        soft_pull_consent: true,
                        homeowner_consent: true,
                      });
                    }}
                  >
                    {t("enroll.devFill")}
                  </button>
                ) : null}
                {error ? (
                  <p className="enroll-error" role="alert">
                    {translateApiError(t, error)}
                  </p>
                ) : null}

                {step === 0 ? (
                  <div className="enroll-fields">
                    <div className="enroll-field-row">
                      <TextField name="first_name" labelKey="form.firstName" />
                      <TextField name="last_name" labelKey="form.lastName" />
                    </div>
                    <TextField name="email" labelKey="form.email" type="email" />
                    <TextField name="phone" labelKey="form.phone" type="tel" />
                  </div>
                ) : null}

                {step === 1 ? (
                  <div className="enroll-fields">
                    <TextField name="property_address" labelKey="form.address" />
                    <div className="enroll-field-row">
                      <TextField name="property_city" labelKey="pf.city" />
                      <TextField name="property_zip" labelKey="pf.zip" />
                    </div>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="enroll-fields">
                    <SelectField
                      name="adu_plan_id"
                      labelKey="pf.plan"
                      options={[
                        { value: "", label: t("aff.planUnknown") },
                        ...plans.map((p) => ({
                          value: p.id,
                          label: `${p.name} · ${p.sq_ft} ${t("pf.sqft")}`,
                        })),
                      ]}
                    />
                    <SelectField
                      name="preferred_language"
                      labelKey="admin.profileLanguage"
                      options={[
                        { value: "en", label: t("lang.en") },
                        { value: "es", label: t("lang.es") },
                      ]}
                    />
                  </div>
                ) : null}

                {step === 3 ? (
                  <div className="enroll-fields enroll-consents">
                    <CheckField
                      name="homeowner_consent"
                      labelKey="enroll.homeownerConsent"
                    />
                    <CheckField
                      name="soft_pull_consent"
                      labelKey="enroll.softPullConsent"
                    />
                    <p className="enroll-consent-hint">{t("enroll.softPullHint")}</p>
                  </div>
                ) : null}

                <div className="enroll-actions">
                  {step > 0 ? (
                    <button
                      type="button"
                      className="enroll-back"
                      onClick={() => setStep((s) => Math.max(0, s - 1))}
                    >
                      <ArrowLeft size={16} aria-hidden /> {t("enroll.back")}
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="submit"
                    className={`button button-gold enroll-next${isSubmitting || submitting ? " pf-btn--busy" : ""}`}
                    disabled={isSubmitting || submitting}
                    aria-busy={isSubmitting || submitting || undefined}
                  >
                    {isSubmitting || submitting ? (
                      <>
                        <Loader2 className="spin" size={16} aria-hidden />{" "}
                        {t("pf.busy.submitting")}
                      </>
                    ) : step === ENROLL_STEP_COUNT - 1 ? (
                      t("enroll.submit")
                    ) : (
                      <>
                        {t("enroll.next")} <ArrowRight size={16} aria-hidden />
                      </>
                    )}
                  </button>
                </div>
              </Form>
            )}
          </Formik>
        </div>
      </div>
    </div>
  );
}
