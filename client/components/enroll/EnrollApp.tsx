import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PublicAffiliateCard } from "@shared/api";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PageMeta from "@/components/PageMeta";

type Props = {
  children: ReactNode;
  title: string;
  description: string;
  canonical: string;
  noIndex?: boolean;
  affiliate?: PublicAffiliateCard | null;
  /** When true, hide the close/home control (e.g. loading). */
  hideClose?: boolean;
};

/**
 * Dedicated full-viewport enrollment chrome (wizard pattern).
 * No marketing SiteHeader / SiteFooter — keeps short forms from fighting a tall footer.
 */
export default function EnrollApp({
  children,
  title,
  description,
  canonical,
  noIndex,
  affiliate,
  hideClose,
}: Props) {
  const { t } = useTranslation();
  const affiliateName = affiliate
    ? `${affiliate.first_name} ${affiliate.last_name}`.trim()
    : "";

  return (
    <div className="enroll-app">
      <PageMeta
        title={title}
        description={description}
        canonical={canonical}
        noIndex={noIndex}
      />
      <header className="enroll-app-top">
        <Link className="enroll-app-brand" to="/" aria-label={t("brand.ariaHome")}>
          <img
            src="/logos/groundwork-logo.png"
            alt={t("brand.name")}
            className="enroll-app-logo"
          />
        </Link>
        <div className="enroll-app-context">
          <p className="enroll-app-product">{t("enroll.appTitle")}</p>
          {affiliateName ? (
            <p className="enroll-app-with">
              {t("enroll.appWith")}{" "}
              <span className="enroll-app-with-name">{affiliateName}</span>
              {affiliate?.company ? (
                <span className="enroll-app-with-co"> · {affiliate.company}</span>
              ) : null}
            </p>
          ) : (
            <p className="enroll-app-with">{t("enroll.appSubtitle")}</p>
          )}
        </div>
        <div className="enroll-app-top-actions">
          <LanguageSwitcher />
          {!hideClose ? (
            <Link
              className="enroll-app-close"
              to="/"
              aria-label={t("enroll.closeAria")}
            >
              <X size={18} aria-hidden />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="enroll-app-body">{children}</div>
      <footer className="enroll-app-foot">
        <p className="enroll-app-trust">{t("enroll.trustLine")}</p>
        <p className="enroll-app-copy">{t("enroll.copyright", { year: new Date().getFullYear() })}</p>
      </footer>
    </div>
  );
}
