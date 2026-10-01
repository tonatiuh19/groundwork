import { useTranslation } from "react-i18next";
import PageMeta from "@/components/PageMeta";

/** Placeholder until list screens ship — keeps nav routes from 404. */
export default function PortalComingSoon({
  titleKey,
}: {
  titleKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="portal-page">
      <PageMeta title={t(titleKey)} description={t("portalDash.comingSoon")} noIndex />
      <p className="eyebrow">
        <span className="eyebrow-line" /> {t("portalDash.eyebrow")}
      </p>
      <h1>{t(titleKey)}</h1>
      <p className="portal-page-lead">{t("portalDash.comingSoon")}</p>
    </div>
  );
}
