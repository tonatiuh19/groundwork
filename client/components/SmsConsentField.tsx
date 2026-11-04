import { useField } from "formik";
import { useTranslation } from "react-i18next";

/** Formik checkbox: OK to text automatic follow-ups (field `sms_marketing_consent`). */
export default function SmsConsentField({ name = "sms_marketing_consent" }: { name?: string }) {
  const { t } = useTranslation();
  const [field, , helpers] = useField<boolean>(name);
  return (
    <label className="consent">
      <input type="checkbox" name={name} checked={Boolean(field.value)} onChange={(e) => void helpers.setValue(e.target.checked)} onBlur={field.onBlur} />
      <span>{t("form.smsFollowUpConsent")}</span>
    </label>
  );
}
