import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PageMeta from "@/components/PageMeta";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="groundwork-page">
      <PageMeta
        title={t("notFound.title")}
        description={t("notFound.body")}
        noIndex
      />
      <header className="site-header">
        <Link className="brand" to="/" aria-label={t("brand.ariaHome")}>
          <img
            className="brand-logo"
            src="/logos/groundwork-logo.png"
            alt={t("brand.name")}
          />
        </Link>
        <div className="header-actions">
          <LanguageSwitcher />
        </div>
      </header>
      <main style={{ padding: "4rem 1.5rem", maxWidth: 640, margin: "0 auto" }}>
        <h1>{t("notFound.heading")}</h1>
        <p style={{ marginTop: "0.75rem" }}>{t("notFound.body")}</p>
        <p style={{ marginTop: "1.5rem" }}>
          <Link className="button button-gold" to="/">
            {t("notFound.home")}
          </Link>
        </p>
      </main>
    </div>
  );
}
