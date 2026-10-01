import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import EnrollApp from "@/components/enroll/EnrollApp";

export default function EnrollInactive() {
  const { t } = useTranslation();

  return (
    <EnrollApp
      title={t("enroll.inactiveTitle")}
      description={t("enroll.inactiveBody")}
      canonical="/r/expired"
      noIndex
    >
      <div className="enroll-layout enroll-layout--center">
        <section className="enroll-inactive">
          <h1>{t("enroll.inactiveTitle")}</h1>
          <p>{t("enroll.inactiveBody")}</p>
          <Link className="button button-gold" to="/start">
            {t("enroll.inactiveCta")}
          </Link>
        </section>
      </div>
    </EnrollApp>
  );
}
