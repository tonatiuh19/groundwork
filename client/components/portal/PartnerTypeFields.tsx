import { useFormikContext } from "formik";
import * as Yup from "yup";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Building2, Home, Landmark } from "lucide-react";
import { TextField } from "@/components/portal/kit";
import { cn } from "@/lib/cn";

export type PartnerTypeValues = { partner_type: "" | "realtor" | "lender" | "other"; company: string; license_number: string };
export const PARTNER_TYPE_DEFAULTS: PartnerTypeValues = { partner_type: "", company: "", license_number: "" };

/** Yup rules: Realtor needs company + DRE #, Lender needs company + NMLS #. */
export function partnerTypeSchema(t: TFunction, required = true) {
  return {
    partner_type: required ? Yup.string().oneOf(["realtor", "lender", "other"], t("validation.partnerTypeRequired")).required(t("validation.partnerTypeRequired")) : Yup.string(),
    company: Yup.string()
      .trim()
      .when("partner_type", { is: (v: string) => v === "realtor" || v === "lender", then: (s) => s.required(t("validation.partnerCompany")) }),
    license_number: Yup.string()
      .trim()
      .when("partner_type", {
        is: "realtor",
        then: (s) => s.min(3, t("validation.dreRequired")).required(t("validation.dreRequired")),
      })
      .when("partner_type", {
        is: "lender",
        then: (s) => s.min(3, t("validation.nmlsRequired")).required(t("validation.nmlsRequired")),
      }),
  };
}

/** Payload for the API from the form values. */
export function partnerTypePayload(v: PartnerTypeValues) {
  return {
    partner_type: v.partner_type || null,
    company: v.company.trim() || null,
    license_number: v.partner_type === "realtor" || v.partner_type === "lender" ? v.license_number.trim() || null : null,
  };
}

/**
 * "I am a…" Realtor (company + DRE #) / Lender (company + NMLS #) / Neither.
 * Used by every affiliate signup form (Partners page, affiliate link, signup, team invite, admin).
 */
export default function PartnerTypeFields({ companyOptional = true }: { companyOptional?: boolean }) {
  const { t } = useTranslation();
  const { values, setFieldValue, errors, touched } = useFormikContext<PartnerTypeValues>();
  const opts = [
    { v: "realtor" as const, icon: Home, label: t("partnerType.realtor") },
    { v: "lender" as const, icon: Landmark, label: t("partnerType.lender") },
    { v: "other" as const, icon: Building2, label: t("partnerType.other") },
  ];
  const licensed = values.partner_type === "realtor" || values.partner_type === "lender";
  return (
    <div className="gw-ptype">
      <span className="gw-ptype__label">{t("partnerType.question")}</span>
      <div className="gw-ptype__opts" role="radiogroup" aria-label={t("partnerType.question")}>
        {opts.map(({ v, icon: Icon, label }) => (
          <button key={v} type="button" role="radio" aria-checked={values.partner_type === v} className={cn("gw-ptype__opt", values.partner_type === v && "is-on")} onClick={() => void setFieldValue("partner_type", v)}>
            <Icon size={16} aria-hidden /> {label}
          </button>
        ))}
      </div>
      {touched.partner_type && errors.partner_type ? <p className="pf-error">{String(errors.partner_type)}</p> : null}
      {licensed ? (
        <div className="gw-ptype__fields">
          <TextField name="company" labelKey={values.partner_type === "realtor" ? "partnerType.brokerage" : "partnerType.lenderCompany"} autoComplete="organization" />
          <TextField name="license_number" labelKey={values.partner_type === "realtor" ? "partnerType.dre" : "partnerType.nmls"} />
        </div>
      ) : values.partner_type === "other" && !companyOptional ? null : values.partner_type === "other" ? (
        <TextField name="company" labelKey="partnerType.companyOptional" autoComplete="organization" />
      ) : null}
    </div>
  );
}
