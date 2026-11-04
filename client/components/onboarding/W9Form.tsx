import { useMemo } from "react";
import { Formik, Form, useFormikContext } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import type { W9TaxClassification } from "@shared/api";
import { ErrorNote, SubmitButton, TextField } from "@/components/portal/kit";
import SignaturePad from "@/components/portal/SignaturePad";
import { cn } from "@/lib/cn";

const CLASSES: W9TaxClassification[] = ["individual", "c_corp", "s_corp", "partnership", "trust_estate", "llc", "other"];

export type W9FormBody = {
  legal_name: string;
  business_name: string | null;
  tax_classification: W9TaxClassification;
  llc_tax_class: "C" | "S" | "P" | null;
  other_classification: string | null;
  foreign_partners: boolean;
  exempt_payee_code: string | null;
  fatca_code: string | null;
  address: string;
  city_state_zip: string;
  tin_type: "ssn" | "ein";
  tin: string;
  signature_image: string;
  certify: true;
};

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
 * The online W-9 (affiliates and City Partners): we fill and sign the official IRS form on the server;
 * the full SSN/EIN only ever lives inside that private PDF.
 */
export default function W9Form({
  defaultLegalName,
  defaultBusinessName,
  submitting,
  error,
  onSubmit,
}: {
  defaultLegalName: string;
  defaultBusinessName: string;
  submitting: boolean;
  error: string | null | undefined;
  onSubmit: (body: W9FormBody) => Promise<void>;
}) {
  const { t } = useTranslation();
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

  return (
          <Formik
            initialValues={{
              legal_name: defaultLegalName,
              business_name: defaultBusinessName,
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
              await onSubmit({
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
                });
            }}
          >
            {({ values, setFieldValue, errors, touched }) => (
              <Form className="pf-form gw-w9-form" autoComplete="off">
                <ErrorNote error={error} />
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
  );
}
