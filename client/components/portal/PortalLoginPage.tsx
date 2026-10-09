import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PortalActor } from "@shared/api";
import PageMeta from "@/components/PageMeta";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import OtpCodeInput from "@/components/portal/OtpCodeInput";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearPortalAuthError,
  fetchPortalMe,
  requestPortalOtp,
  verifyPortalOtp,
} from "@/store/slices/portalAuthSlice";
import { translateApiError } from "@/lib/api";

type Props = {
  actor: PortalActor;
  homePath: string;
};

const RESEND_SEC = 45;

const COPY: Record<
  PortalActor,
  { titleKey: string; leadKey: string; accent: string }
> = {
  admin: {
    titleKey: "portalAuth.adminTitle",
    leadKey: "portalAuth.adminLead",
    accent: "ink",
  },
  affiliate: {
    titleKey: "portalAuth.affiliateTitle",
    leadKey: "portalAuth.affiliateLead",
    accent: "gold",
  },
  contractor: {
    titleKey: "portalAuth.contractorTitle",
    leadKey: "portalAuth.contractorLead",
    accent: "pine",
  },
  client: {
    titleKey: "portalAuth.clientTitle",
    leadKey: "portalAuth.clientLead",
    accent: "clay",
  },
};

/** Resolve ?return= to a same-portal relative path (blocks open redirects). */
function resolveReturnPath(
  actor: PortalActor,
  homePath: string,
  raw: string | null,
): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return homePath;
  try {
    const u = new URL(raw, "https://www.groundworkcapitalgroup.com");
    if (!u.pathname.startsWith(`/${actor}`)) return homePath;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return homePath;
  }
}

export default function PortalLoginPage({ actor, homePath }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { requesting, verifying, error, otpEmail, user } =
    useAppSelector((s) => s.portalAuth[actor]);
  const [step, setStep] = useState<"email" | "code">(
    otpEmail ? "code" : "email",
  );
  const [email, setEmail] = useState(otpEmail || "");
  const [resendIn, setResendIn] = useState(0);
  const [probingSession, setProbingSession] = useState(true);
  const meta = COPY[actor];
  const isStatusLegend =
    error === "errors.authPending" || error === "errors.authInvited";
  const afterLoginPath = resolveReturnPath(
    actor,
    homePath,
    searchParams.get("return"),
  );

  useEffect(() => {
    dispatch(clearPortalAuthError(actor));
  }, [actor, dispatch]);

  useEffect(() => {
    let cancelled = false;
    setProbingSession(true);
    // Always re-check the cookie — login must redirect when a session already exists,
    // even if Redux was previously bootstrapped as logged-out.
    void dispatch(fetchPortalMe(actor)).finally(() => {
      if (!cancelled) setProbingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, [actor, dispatch]);

  useEffect(() => {
    if (!probingSession && user) {
      navigate(afterLoginPath, { replace: true });
    }
  }, [probingSession, user, afterLoginPath, navigate]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  const runVerify = useCallback(
    async (code: string) => {
      const result = await dispatch(
        verifyPortalOtp({ actor, email, code: code.trim() }),
      );
      if (verifyPortalOtp.fulfilled.match(result)) {
        navigate(afterLoginPath);
      }
    },
    [actor, dispatch, email, afterLoginPath, navigate],
  );

  if (probingSession || user) {
    return (
      <div className={`portal-login portal-login--${meta.accent}`}>
        <PageMeta
          title={t(meta.titleKey)}
          description={t(meta.leadKey)}
          canonical={`/${actor}/login`}
          noIndex
        />
        <div className="portal-login-stage" aria-busy="true" aria-live="polite">
          <p className="portal-login-session-check">
            <Loader2 className="spin" size={22} aria-hidden />
            <span>{t("portalAuth.checkingSession")}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`portal-login portal-login--${meta.accent}`}>
      <PageMeta
        title={t(meta.titleKey)}
        description={t(meta.leadKey)}
        canonical={`/${actor}/login`}
        noIndex
      />
      <div className="portal-login-stage">
        <aside className="portal-login-brand">
          <Link to="/" className="portal-login-logo">
            <img src="/logos/groundwork-logo.png" alt="Groundwork Capital" />
          </Link>
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("portalAuth.eyebrow")}
          </p>
          <h1>{t(meta.titleKey)}</h1>
          <p>{t(meta.leadKey)}</p>
          <ul className="portal-login-points">
            <li>
              <ShieldCheck size={16} /> {t("portalAuth.pointSecure")}
            </li>
            <li>
              <ShieldCheck size={16} /> {t("portalAuth.pointOtp")}
            </li>
            <li>
              <ShieldCheck size={16} /> {t("portalAuth.pointSession")}
            </li>
          </ul>
        </aside>
        <section className="portal-login-card">
          <div className="portal-login-card-top">
            <LanguageSwitcher />
          </div>
          {step === "email" ? (
            <Formik
              key="email-step"
              initialValues={{ email }}
              validationSchema={Yup.object({
                email: Yup.string()
                  .email(t("validation.emailInvalid"))
                  .required(t("validation.emailRequired")),
              })}
              onSubmit={async (values) => {
                const result = await dispatch(
                  requestPortalOtp({ actor, email: values.email.trim() }),
                );
                if (requestPortalOtp.fulfilled.match(result)) {
                  setEmail(values.email.trim());
                  setStep("code");
                  setResendIn(RESEND_SEC);
                }
              }}
            >
              {({ errors, touched }) => (
                <Form className="portal-login-form">
                  <h2>{t("portalAuth.emailStep")}</h2>
                  <p className="portal-login-hint">{t("portalAuth.emailHint")}</p>
                  {actor === "affiliate" ||
                  actor === "client" ||
                  actor === "contractor" ? (
                    <p className="portal-login-legend">{t("portalAuth.pendingLegend")}</p>
                  ) : null}
                  {error ? (
                    <p
                      className={
                        isStatusLegend
                          ? "portal-login-legend portal-login-legend--alert"
                          : "form-error"
                      }
                      role="alert"
                    >
                      {translateApiError(t, error)}
                    </p>
                  ) : null}
                  <label>
                    {t("form.email")}
                    <Field name="email" type="email" autoComplete="email" />
                    {touched.email && errors.email ? (
                      <span className="form-error">{errors.email}</span>
                    ) : null}
                  </label>
                  <button
                    className="button button-gold form-submit"
                    type="submit"
                    disabled={requesting}
                  >
                    {requesting ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <>
                        {t("portalAuth.sendCode")} <ArrowRight size={15} />
                      </>
                    )}
                  </button>
                </Form>
              )}
            </Formik>
          ) : (
            <Formik
              key="code-step"
              initialValues={{ code: "" }}
              validationSchema={Yup.object({
                code: Yup.string()
                  .matches(/^\d{6}$/, t("validation.otpInvalid"))
                  .required(t("validation.otpRequired")),
              })}
              onSubmit={async (values) => {
                if (verifying) return;
                await runVerify(values.code);
              }}
            >
              {({ errors, touched, values, setFieldValue }) => (
                <Form className="portal-login-form">
                  <h2>{t("portalAuth.codeStep")}</h2>
                  <p className="portal-login-hint">
                    {t("portalAuth.codeHint", { email })}
                  </p>
                  <p className="portal-login-hint portal-login-hint--secondary">
                    {t("portalAuth.codeHintDetail")}
                  </p>
                  {actor === "affiliate" ? (
                    <p className="portal-login-legend">
                      {t("portalAuth.codeNoAccountAffiliate")}{" "}
                      <Link className="text-link" to="/affiliate/signup">
                        {t("portalAuth.becomeAffiliate")}
                      </Link>
                    </p>
                  ) : null}
                  {actor === "client" ? (
                    <p className="portal-login-legend">
                      {t("portalAuth.codeNoAccountClient")}{" "}
                      <Link className="text-link" to="/client/signup">
                        {t("portalAuth.createClientAccount")}
                      </Link>
                    </p>
                  ) : null}
                  {actor === "contractor" ? (
                    <p className="portal-login-legend">
                      {t("portalAuth.codeNoAccountContractor")}{" "}
                      <Link className="text-link" to="/contractor/signup">
                        {t("portalAuth.createContractorAccount")}
                      </Link>
                    </p>
                  ) : null}
                  {error ? (
                    <p className="form-error" role="alert">
                      {translateApiError(t, error)}
                    </p>
                  ) : null}
                  <OtpCodeInput
                    label={t("portalAuth.codeLabel")}
                    value={values.code}
                    verifying={verifying}
                    disabled={verifying}
                    onChange={(code) => {
                      void setFieldValue("code", code, true);
                    }}
                    onComplete={(code) => {
                      if (verifying) return;
                      void setFieldValue("code", code, false);
                      void runVerify(code);
                    }}
                  />
                  {touched.code && errors.code ? (
                    <span className="form-error">{errors.code}</span>
                  ) : null}
                  <button
                    className="button button-gold form-submit"
                    type="submit"
                    disabled={verifying || values.code.length !== 6}
                  >
                    {verifying ? (
                      <>
                        <Loader2 className="spin" size={16} />{" "}
                        {t("portalAuth.verifying")}
                      </>
                    ) : (
                      <>
                        {t("portalAuth.verify")} <ArrowRight size={15} />
                      </>
                    )}
                  </button>
                  <div className="portal-login-secondary">
                    <button
                      type="button"
                      className="text-link"
                      disabled={resendIn > 0 || requesting || verifying}
                      aria-busy={requesting || undefined}
                      onClick={async () => {
                        const result = await dispatch(
                          requestPortalOtp({ actor, email }),
                        );
                        if (requestPortalOtp.fulfilled.match(result)) {
                          setResendIn(RESEND_SEC);
                          void setFieldValue("code", "", false);
                        }
                      }}
                    >
                      {requesting
                        ? t("portalAuth.resending")
                        : resendIn > 0
                          ? t("portalAuth.resendIn", { seconds: resendIn })
                          : t("portalAuth.resend")}
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      disabled={verifying}
                      onClick={() => {
                        setStep("email");
                        dispatch(clearPortalAuthError(actor));
                      }}
                    >
                      {t("portalAuth.changeEmail")}
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          )}
          {actor === "affiliate" ? (
            <p className="portal-login-hint portal-login-alt">
              {t("portalAuth.newAffiliate")}{" "}
              <Link className="text-link" to="/affiliate/signup">
                {t("portalAuth.becomeAffiliate")}
              </Link>
            </p>
          ) : null}
          {actor === "client" ? (
            <p className="portal-login-hint portal-login-alt">
              {t("portalAuth.newClient")}{" "}
              <Link className="text-link" to="/client/signup">
                {t("portalAuth.createClientAccount")}
              </Link>
            </p>
          ) : null}
          {actor === "contractor" ? (
            <p className="portal-login-hint portal-login-alt">
              {t("portalAuth.newContractor")}{" "}
              <Link className="text-link" to="/contractor/signup">
                {t("portalAuth.createContractorAccount")}
              </Link>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
