import { Link } from "react-router-dom";
import { Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { SITE_PHONE_DISPLAY, SITE_PHONE_TEL } from "@/lib/site";

export default function SiteHeader() {
  const { t } = useTranslation();

  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label={t("brand.ariaHome")}>
        <img
          className="brand-logo"
          src="/logos/groundwork-logo.png"
          alt={t("brand.name")}
        />
      </Link>
      <nav className="desktop-nav" aria-label={t("nav.aria")}>
        <Link to="/about">{t("nav.about")}</Link>
        <Link to="/partners">{t("nav.partners")}</Link>
        <Link to="/contact">{t("nav.contact")}</Link>
        <Link to="/client/login">{t("nav.clientPortal")}</Link>
      </nav>
      <div className="header-actions">
        <LanguageSwitcher />
        <a className="header-phone" href={`tel:${SITE_PHONE_TEL}`}>
          <Phone size={15} strokeWidth={1.8} /> {SITE_PHONE_DISPLAY}
        </a>
      </div>
      {/* Sibling of actions so it can wrap to a full row on narrow screens without clipping. */}
      <Link className="header-portal" to="/client/login">
        {t("nav.clientPortal")}
      </Link>
    </header>
  );
}
