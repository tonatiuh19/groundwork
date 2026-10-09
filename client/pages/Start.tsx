import { useTranslation } from "react-i18next";
import EnrollApp from "@/components/enroll/EnrollApp";
import EnrollWizard from "@/components/enroll/EnrollWizard";
import { getReferralCode } from "@/lib/referral";

/**
 * Public homeowner enrollment — the exact wizard affiliates share via /r/:code,
 * without the affiliate card. Served at /client/signup and /start. A referral
 * cookie from an earlier affiliate link still credits that affiliate silently.
 */
export default function Start({ canonical = "/start" }: { canonical?: string }) {
  const { t } = useTranslation();
  const referralCode = getReferralCode();

  return (
    <EnrollApp
      title={t("enroll.metaTitle")}
      description={t("enroll.metaDescription")}
      canonical={canonical}
    >
      <EnrollWizard referralCode={referralCode} leadKey="enroll.lead" />
    </EnrollApp>
  );
}
