import { useFormikContext } from "formik";
import { useTranslation } from "react-i18next";
import { CheckField } from "@/components/portal/kit";

/**
 * Homeowner added without an email: their portal link goes by text, so they must agree to texts.
 * Shown only while the form's `email` is empty (Formik field `sms_consent`).
 */
export default function PhoneOnlyConsent() {
  const { t } = useTranslation();
  const { values } = useFormikContext<{ email?: string }>();
  if (String(values.email || "").trim()) return null;
  return (
    <div className="gw-phone-only">
      <p className="pf-hint">{t("phoneOnly.hint")}</p>
      <CheckField name="sms_consent" labelKey="phoneOnly.consent" />
    </div>
  );
}

/** Yup test for `sms_consent`: required only when there's no email. */
export const phoneOnlyConsentTest = () =>
  function (this: { parent: { email?: string } }, v: unknown) {
    return Boolean(String(this.parent?.email || "").trim()) || v === true;
  } as unknown as (v: unknown) => boolean;
