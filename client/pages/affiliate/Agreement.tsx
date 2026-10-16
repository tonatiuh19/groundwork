import { useEffect, useMemo, useState } from "react";
import { Formik, Form, useFormikContext } from "formik";
import * as Yup from "yup";
import { CheckCircle2, CreditCard, Download, FileSignature, FileText, Lock, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { W9TaxClassification } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearOnboardingErrors,
  fetchAffiliateOnboarding,
  signAffiliateAgreement,
  submitAffiliateW9,
} from "@/store/slices/affiliateOnboardingSlice";
import { ErrorNote, Loading, PageHeader, StatusBadge, SubmitButton, TextField } from "@/components/portal/kit";
import SignaturePad from "@/components/portal/SignaturePad";
import AgreementDocument, { previewAgreement } from "@/components/affiliate/AgreementDocument";
import AffiliateBillingStep from "@/components/affiliate/AffiliateBillingStep";
import { useFormatters } from "@/lib/format";
import { withOnboardingToken } from "@/lib/onboardingToken";
import { cn } from "@/lib/cn";

const CLASSES: W9TaxClassification[] = ["individual", "c_corp", "s_corp", "partnership", "trust_estate", "llc", "other"];

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Signature pad bound to a Formik field (PNG data URL or ""). */
function SignatureField({ name }: { name: string }) {
  const { t } = useTranslation();
  const { setFieldValue, errors, touched, isSubmitting } = useFormikContext<Record<string, unknown>>();
  const invalid = Boolean(touched[name] && errors[name]);
  return (
    <div className="pf-field">
      <span>{t("affAgreement.signature")}</span>
      <SignaturePad invalid={invalid} disabled={isSubmitting} onChange={(v) => void setFieldValue(name, v || "")} />
      {invalid ? <span className="form-error">{String(errors[name])}</span> : null}
    </div>
  );
}

function CheckBox({ name, labelKey }: { name: string; labelKey: string }) {
  const { t } = useTranslation();
  const { values, setFieldValue, errors, touched } = useFormikContext<Record<string, unknown>>();
  return (
    <label className={cn("gw-check", touched[name] && errors[name] ? "pf-field--invalid" : null)}>
      <input type="checkbox" checked={values[name] === true} onChange={(e) => void setFieldValue(name, e.target.checked)} />
      <span>{t(labelKey)}</span>
    </label>
  );
}

/**
 * Affiliate onboarding. Step 1: read (EN/ES) and e-sign the Affiliate
 * Agreement. Step 2: complete the W-9 online (we fill and sign the official
 * IRS form; the full SSN/EIN is stored only inside that private PDF). Step 3:
 * card on file (free period, then monthly). Referral fees are paid only after
 * all three. Used by the portal (logged in) and the welcome link (no login,
 * signing allowed while the application is pending).
 */
export function AffiliateOnboardingFlow({ mode }: { mode: "portal" | "welcome" }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const uiLang = i18n.language?.startsWith("es") ? "es" : "en";
  const [docLang, setDocLang] = useState<"en" | "es">(uiLang);
  const { portal, portalLoading, portalError, submitError, submitting } = useAppSelector((s) => s.affiliateOnboarding);

  useEffect(() => {
    dispatch(clearOnboardingErrors());
    void dispatch(fetchAffiliateOnboarding(docLang));
  }, [dispatch, docLang]);

  const signSchema = useMemo(
    () =>
      Yup.object({
        legal_name: Yup.string().trim().min(2, t("validation.signerNameRequired")).required(t("validation.signerNameRequired")),
        business_name: Yup.string().trim().max(200),
        title: Yup.string().trim().max(120),
        address: Yup.string().trim().min(8, t("validation.addressRequired")).required(t("validation.addressRequired")),
        phone: Yup.string().trim().max(40),
        consent: Yup.boolean().oneOf([true], t("validation.esignConsentRequired")),
        signature_image: Yup.string().required(t("validation.signatureRequired")),
      }),
    [t],
  );

  const w9Schema = useMemo(
    () =>
      Yup.object({
        legal_name: Yup.string().trim().min(2, t("validation.signerNameRequired")).required(t("validation.signerNameRequired")),
        business_name: Yup.string().trim().max(200),
        tax_classification: Yup.string().oneOf(CLASSES).required(t("validation.w9Classification")),
        llc_tax_class: Yup.string().when("tax_classification", {
          is: "llc",
          then: (s) => s.oneOf(["C", "S", "P"], t("validation.w9LlcClass")).required(t("validation.w9LlcClass")),
        }),
        other_classification: Yup.string().when("tax_classification", {
          is: "other",
          then: (s) => s.trim().required(t("validation.w9Classification")),
        }),
        address: Yup.string().trim().min(4, t("validation.addressRequired")).required(t("validation.addressRequired")),
        city_state_zip: Yup.string().trim().min(5, t("validation.addressRequired")).required(t("validation.addressRequired")),
        tin_type: Yup.string().oneOf(["ssn", "ein"]).required(),
        tin: Yup.string()
          .transform((v) => String(v || "").replace(/\D/g, ""))
          .length(9, t("validation.w9Tin"))
          .required(t("validation.w9Tin")),
        certify: Yup.boolean().oneOf([true], t("validation.w9CertifyRequired")),
        signature_image: Yup.string().required(t("validation.signatureRequired")),
      }),
    [t],
  );

  const shell = mode === "portal" ? "portal-page" : "gw-welcome-flow";
  if (portalLoading && !portal) return <div className={shell}><Loading /></div>;
  if (!portal) return <div className={shell}><ErrorNote error={portalError} /></div>;

  const { state, affiliate, template, agreement, w9 } = portal;
  // Pending applicants may sign from the welcome link; payouts still need approval.
  const approved = affiliate.status === "active" || affiliate.status === "pending";
  const billingReady = state.billing_ready;
  const link = (url: string) => (mode === "welcome" ? withOnboardingToken(url) : url);
  const pricePending = state.subscription_price_cents == null;
  // A newer published version: they review and sign it (the signed older one stays in effect until then).
  const outdated = state.agreement_outdated;
  const canSign = approved && !pricePending && (!state.agreement_signed || outdated);
  const w9Open = state.agreement_signed && (state.w9_status === "missing" || state.w9_status === "rejected");
  const party = [affiliate.first_name + " " + affiliate.last_name, affiliate.phone, affiliate.email].filter(Boolean).join(", ");
  const previewBody = previewAgreement(template.body, {
    date: new Intl.DateTimeFormat(docLang === "es" ? "es-US" : "en-US", { dateStyle: "long", timeZone: "America/Los_Angeles" }).format(new Date()),
    party,
    price: pricePending ? t("affAgreement.pricePending") : money(state.subscription_price_cents!),
  });

  return (
    <div className={cn(shell, "gw-agreement-page")}>
      {mode === "portal" ? <PageHeader titleKey="affAgreement.title" leadKey="affAgreement.lead" /> : null}

      <ol className="gw-onboard-steps" aria-label={t("affAgreement.stepsAria")}>
        <li className={cn(state.agreement_signed && "is-done")}>
          {state.agreement_signed ? <CheckCircle2 size={18} aria-hidden /> : <FileSignature size={18} aria-hidden />}
          <span>{t("affAgreement.step1")}</span>
        </li>
        <li className={cn(state.w9_status === "submitted" || state.w9_status === "accepted" ? "is-done" : null, state.w9_status === "rejected" && "is-bad")}>
          {state.w9_status === "submitted" || state.w9_status === "accepted" ? <CheckCircle2 size={18} aria-hidden /> : <FileText size={18} aria-hidden />}
          <span>{t("affAgreement.step2")}</span>
        </li>
        <li className={cn(billingReady && portal.billing.status !== "none" && "is-done", portal.billing.status === "past_due" && "is-bad")}>
          {billingReady && portal.billing.status !== "none" ? <CheckCircle2 size={18} aria-hidden /> : <CreditCard size={18} aria-hidden />}
          <span>{t("affAgreement.step3")}</span>
        </li>
      </ol>
      {state.payout_ready ? (
        <p className="gw-onboard-ready" role="status">
          <ShieldCheck size={16} aria-hidden /> {t("affAgreement.payoutReady")}
        </p>
      ) : (
        <p className="pf-hint">{t("affAgreement.payoutHold")}</p>
      )}

      {/* Step 1 — Agreement */}
      <section className="pf-section">
        <div className="pf-section-head">
          <h2 className="pf-h2">{t("affAgreement.step1")}</h2>
          {agreement ? <StatusBadge group="affAgreement.status" value="signed" /> : null}
        </div>

        {agreement ? (
          <div className="gw-onboard-done">
            <p>
              {t("affAgreement.signedOn", { date: fmt.date(agreement.signed_at), version: agreement.version })}
            </p>
            {outdated ? (
              <p className="gw-onboard-note gw-onboard-note--update" role="status">
                {t("affAgreement.updatedNote", { version: state.agreement_current_version })}
              </p>
            ) : null}
            <a className="pf-btn" href={link("/api/affiliate/onboarding/agreement/pdf")} target="_blank" rel="noreferrer">
              <Download size={15} aria-hidden /> {t("affAgreement.downloadSigned")}
            </a>
          </div>
        ) : !approved ? (
          <p className="gw-onboard-note"><Lock size={15} aria-hidden /> {t("affAgreement.afterApproval")}</p>
        ) : pricePending ? (
          <p className="gw-onboard-note"><Lock size={15} aria-hidden /> {t("affAgreement.afterCall")}</p>
        ) : null}

        {!agreement || outdated ? (
          <>
            <div className="gw-agreement-langs" role="group" aria-label={t("affAgreement.langAria")}>
              {(["en", "es"] as const).map((l) => (
                <button key={l} type="button" className={cn("pf-btn pf-btn--sm", docLang === l && "is-active")} aria-pressed={docLang === l} onClick={() => setDocLang(l)}>
                  {l === "en" ? "English" : "Español"}
                </button>
              ))}
            </div>
            {docLang === "es" ? <p className="pf-hint">{t("affAgreement.englishControls")}</p> : null}
            <div className="gw-agreement-scroll" tabIndex={0} aria-label={t("affAgreement.docAria")}>
              <AgreementDocument body={previewBody} />
              {portal.sponsor_name ? (
                <p className="gw-agreement-sponsor">
                  <strong>{t("affAgreement.sponsor")}:</strong> {portal.sponsor_name}
                  {portal.senior_sponsor_name ? <> · <strong>{t("affAgreement.seniorSponsor")}:</strong> {portal.senior_sponsor_name}</> : null}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {canSign ? (
          <Formik
            initialValues={{
              legal_name: `${affiliate.first_name} ${affiliate.last_name}`.trim(),
              business_name: affiliate.company || "",
              title: "",
              address: "",
              phone: affiliate.phone || "",
              consent: false,
              signature_image: "",
            }}
            validationSchema={signSchema}
            onSubmit={async (v) => {
              await dispatch(
                signAffiliateAgreement({
                  version: template.version,
                  lang: docLang,
                  legal_name: v.legal_name.trim(),
                  business_name: v.business_name.trim() || null,
                  title: v.title.trim() || null,
                  address: v.address.trim(),
                  phone: v.phone.trim() || null,
                  signature_image: v.signature_image,
                  consent: true,
                }),
              );
            }}
          >
            <Form className="pf-form gw-sign-form">
              <ErrorNote error={submitError} />
              <div className="pf-form-grid">
                <TextField name="legal_name" labelKey="affAgreement.legalName" required autoComplete="name" />
                <TextField name="business_name" labelKey="affAgreement.businessName" autoComplete="organization" />
                <TextField name="title" labelKey="affAgreement.titleField" autoComplete="organization-title" />
                <TextField name="phone" labelKey="affAgreement.phone" type="tel" inputMode="tel" autoComplete="tel" />
              </div>
              <TextField name="address" labelKey="affAgreement.address" required autoComplete="street-address" />
              <SignatureField name="signature_image" />
              <CheckBox name="consent" labelKey="affAgreement.consent" />
              <SubmitButton labelKey="affAgreement.signCta" busy={submitting} />
            </Form>
          </Formik>
        ) : null}
      </section>

      {/* Step 2 — W-9 */}
      <section className={cn("pf-section", !state.agreement_signed && "is-locked")}>
        <div className="pf-section-head">
          <h2 className="pf-h2">{t("affAgreement.step2")}</h2>
          {w9 ? <StatusBadge group="affAgreement.w9Status" value={w9.status} /> : null}
        </div>
        <p className="pf-hint">
          {t("affAgreement.w9Lead")}{" "}
          <a className="text-link" href={portal.blank_w9_url} target="_blank" rel="noreferrer">{t("affAgreement.blankW9")}</a>
        </p>

        {!state.agreement_signed ? (
          <p className="gw-onboard-note"><Lock size={15} aria-hidden /> {t("affAgreement.w9AfterAgreement")}</p>
        ) : null}

        {w9 && w9.status !== "rejected" ? (
          <div className="gw-onboard-done">
            <p>
              {t("affAgreement.w9OnFile", { type: w9.tin_type.toUpperCase(), last4: w9.tin_last4, date: fmt.date(w9.signed_at) })}
            </p>
            <a className="pf-btn" href={link("/api/affiliate/onboarding/w9/pdf")} target="_blank" rel="noreferrer">
              <Download size={15} aria-hidden /> {t("affAgreement.downloadW9")}
            </a>
          </div>
        ) : null}
        {w9?.status === "rejected" ? (
          <p className="form-error" role="alert">{t("affAgreement.w9Rejected", { note: w9.review_note || "" })}</p>
        ) : null}

        {w9Open ? (
          <Formik
            initialValues={{
              legal_name: agreement?.legal_name || `${affiliate.first_name} ${affiliate.last_name}`.trim(),
              business_name: agreement?.business_name || "",
              tax_classification: "individual" as W9TaxClassification,
              llc_tax_class: "",
              other_classification: "",
              foreign_partners: false,
              exempt_payee_code: "",
              fatca_code: "",
              address: "",
              city_state_zip: "",
              tin_type: "ssn" as "ssn" | "ein",
              tin: "",
              certify: false,
              signature_image: "",
            }}
            validationSchema={w9Schema}
            onSubmit={async (v) => {
              await dispatch(
                submitAffiliateW9({
                  legal_name: v.legal_name.trim(),
                  business_name: v.business_name.trim() || null,
                  tax_classification: v.tax_classification,
                  llc_tax_class: v.tax_classification === "llc" ? (v.llc_tax_class as "C" | "S" | "P") : null,
                  other_classification: v.tax_classification === "other" ? v.other_classification.trim() : null,
                  foreign_partners: v.foreign_partners,
                  exempt_payee_code: v.exempt_payee_code.trim() || null,
                  fatca_code: v.fatca_code.trim() || null,
                  address: v.address.trim(),
                  city_state_zip: v.city_state_zip.trim(),
                  tin_type: v.tin_type,
                  tin: v.tin.replace(/\D/g, ""),
                  signature_image: v.signature_image,
                  certify: true,
                  lang: uiLang,
                }),
              );
            }}
          >
            {({ values, setFieldValue, errors, touched }) => (
              <Form className="pf-form gw-w9-form" autoComplete="off">
                <ErrorNote error={submitError} />
                <TextField name="legal_name" labelKey="affAgreement.w9Line1" required hintKey="affAgreement.w9Line1Hint" />
                <TextField name="business_name" labelKey="affAgreement.w9Line2" />
                <fieldset className="gw-w9-classes">
                  <legend>{t("affAgreement.w9Line3")}</legend>
                  {CLASSES.map((c) => (
                    <label key={c} className="gw-check">
                      <input
                        type="radio"
                        name="tax_classification"
                        checked={values.tax_classification === c}
                        onChange={() => void setFieldValue("tax_classification", c)}
                      />
                      <span>{t(`affAgreement.w9Class.${c}`)}</span>
                    </label>
                  ))}
                </fieldset>
                {values.tax_classification === "llc" ? (
                  <label className={cn("pf-field", touched.llc_tax_class && errors.llc_tax_class && "pf-field--invalid")}>
                    <span>{t("affAgreement.w9LlcClass")}</span>
                    <select value={values.llc_tax_class} onChange={(e) => void setFieldValue("llc_tax_class", e.target.value)}>
                      <option value="">—</option>
                      <option value="C">{t("affAgreement.w9Llc.C")}</option>
                      <option value="S">{t("affAgreement.w9Llc.S")}</option>
                      <option value="P">{t("affAgreement.w9Llc.P")}</option>
                    </select>
                    {touched.llc_tax_class && errors.llc_tax_class ? <span className="form-error">{errors.llc_tax_class}</span> : null}
                  </label>
                ) : null}
                {values.tax_classification === "other" ? (
                  <TextField name="other_classification" labelKey="affAgreement.w9Other" required />
                ) : null}
                {["partnership", "trust_estate"].includes(values.tax_classification) ||
                (values.tax_classification === "llc" && values.llc_tax_class === "P") ? (
                  <CheckBox name="foreign_partners" labelKey="affAgreement.w9Line3b" />
                ) : null}
                <details className="gw-w9-exempt">
                  <summary>{t("affAgreement.w9Exemptions")}</summary>
                  <div className="pf-form-grid">
                    <TextField name="exempt_payee_code" labelKey="affAgreement.w9ExemptPayee" />
                    <TextField name="fatca_code" labelKey="affAgreement.w9Fatca" />
                  </div>
                </details>
                <TextField name="address" labelKey="affAgreement.w9Address" required />
                <TextField name="city_state_zip" labelKey="affAgreement.w9City" required />
                <fieldset className="gw-w9-tin">
                  <legend>{t("affAgreement.w9Tin")}</legend>
                  <div className="gw-w9-tin-types" role="radiogroup">
                    {(["ssn", "ein"] as const).map((k) => (
                      <label key={k} className="gw-check">
                        <input type="radio" name="tin_type" checked={values.tin_type === k} onChange={() => void setFieldValue("tin_type", k)} />
                        <span>{t(`affAgreement.w9TinType.${k}`)}</span>
                      </label>
                    ))}
                  </div>
                  <TextField
                    name="tin"
                    labelKey={values.tin_type === "ssn" ? "affAgreement.w9Ssn" : "affAgreement.w9Ein"}
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    hintKey="affAgreement.w9TinPrivacy"
                  />
                </fieldset>
                <div className="gw-w9-cert">
                  <p><strong>{t("affAgreement.w9CertTitle")}</strong></p>
                  <ol>
                    <li>{t("affAgreement.w9Cert1")}</li>
                    <li>{t("affAgreement.w9Cert2")}</li>
                    <li>{t("affAgreement.w9Cert3")}</li>
                    <li>{t("affAgreement.w9Cert4")}</li>
                  </ol>
                  <p className="pf-hint">{t("affAgreement.w9CertBackup")}</p>
                </div>
                <SignatureField name="signature_image" />
                <CheckBox name="certify" labelKey="affAgreement.w9Certify" />
                <SubmitButton labelKey="affAgreement.w9Submit" busy={submitting} />
              </Form>
            )}
          </Formik>
        ) : null}
      </section>

      {/* Step 3 — Card on file */}
      <section className={cn("pf-section", !state.agreement_signed && "is-locked")}>
        <div className="pf-section-head">
          <h2 className="pf-h2">{t("affAgreement.step3")}</h2>
        </div>
        <AffiliateBillingStep billing={portal.billing} locked={!state.agreement_signed} mode={mode} />
      </section>
    </div>
  );
}

export default function AffiliateAgreementPage() {
  return <AffiliateOnboardingFlow mode="portal" />;
}
