import { useTranslation } from "react-i18next";
import EnrollApp from "@/components/enroll/EnrollApp";
import EnrollWizard from "@/components/enroll/EnrollWizard";
import { getReferralCode } from "@/lib/referral";

export default function Start() {
  const { t } = useTranslation();
  const referralCode = getReferralCode();

  return (
    <EnrollApp
      title={t("enroll.metaTitle")}
      description={t("enroll.metaDescription")}
      canonical="/start"
    >
      <EnrollWizard referralCode={referralCode} leadKey="enroll.lead" />
    </EnrollApp>
  );
}
