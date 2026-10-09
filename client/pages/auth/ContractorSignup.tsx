import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { CheckCircle2, Inbox, LogIn, MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PortalSignupOutcome } from "@shared/api";
import AuthStage from "@/components/portal/AuthStage";
import { ErrorNote, SubmitButton, TextField } from "@/components/portal/kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  resetContractorSignup,
  submitContractorSignup,
} from "@/store/slices/onboardingSlice";
import { yupPhoneRequired } from "@/lib/validation";

function OutcomeCard({
  outcome,
  loginPath,
}: {
  outcome: PortalSignupOutcome;
  loginPath: string;
}) {
  const { t } = useTranslation();
  const Icon =
    outcome === "ready"
      ? LogIn
      : outcome === "invite_resent"
        ? MailCheck
        : outcome === "resent"
          ? Inbox
          : CheckCircle2;
  return (
    <div className="portal-login-form pf-success portal-signup-outcome">
      <div className="portal-signup-outcome-icon" aria-hidden>
        <Icon size={32} />
      </div>
      <h2>{t(`ctrSignup.outcome.${outcome}.title`)}</h2>
      <p className="portal-login-hint">{t(`ctrSignup.outcome.${outcome}.body`)}</p>
      {outcome === "ready" ? (
        <Link className="button button-gold form-submit" to={loginPath}>
          {t("portalAuth.signIn")}
        </Link>
      ) : (
        <Link className="button button-gold form-submit" to="/">
          {t("ctrSignup.backHome")}
        </Link>
      )}
    </div>
  );
}

export default function ContractorSignup() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { submitting, done, outcome, error } = useAppSelector(
    (s) => s.onboarding.contractorSignup,
  );

  useEffect(() => {
    dispatch(resetContractorSignup());
  }, [dispatch]);

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .required(t("validation.emailRequired")),
    phone: yupPhoneRequired(t("validation.phoneMin"), t("validation.phoneRequired")),
    company: Yup.string().trim().max(200),
  });

  return (
    <AuthStage
      accent="pine"
      titleKey="ctrSignup.title"
      leadKey="ctrSignup.lead"
      pointKeys={[
        "ctrSignup.pointProjects",
        "ctrSignup.pointPhotos",
        "ctrSignup.pointDraws",
      ]}
      canonical="/contractor/signup"
    >
      {done && outcome ? (
        <OutcomeCard outcome={outcome} loginPath="/contractor/login" />
      ) : (
        <Formik
          initialValues={{
            first_name: "",
            last_name: "",
            email: "",
            phone: "",
            company: "",
          }}
          validationSchema={schema}
          onSubmit={(v) =>
            dispatch(
              submitContractorSignup({
                first_name: v.first_name.trim(),
                last_name: v.last_name.trim(),
                email: v.email.trim(),
                phone: v.phone.trim(),
                company: v.company.trim() || null,
                preferred_language: i18n.language?.startsWith("es")
                  ? "es"
                  : "en",
              }),
            )
          }
        >
          <Form className="portal-login-form pf-form">
            <h2>{t("ctrSignup.formTitle")}</h2>
            <p className="portal-login-hint">{t("ctrSignup.formHint")}</p>
            <ErrorNote error={error} />
            <div className="pf-form-grid">
              <TextField name="first_name" labelKey="form.firstName" />
              <TextField name="last_name" labelKey="form.lastName" />
            </div>
            <TextField name="email" labelKey="form.email" type="email" />
            <TextField name="phone" labelKey="form.phone" type="tel" />
            <TextField name="company" labelKey="ctrSignup.company" />
            <SubmitButton busy={submitting} labelKey="ctrSignup.submit" />
            <p className="portal-login-hint">
              {t("ctrSignup.haveAccount")}{" "}
              <Link className="text-link" to="/contractor/login">
                {t("portalAuth.signIn")}
              </Link>
            </p>
          </Form>
        </Formik>
      )}
    </AuthStage>
  );
}
