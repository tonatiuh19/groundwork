import { Link } from "react-router-dom";
import { ArrowRight, Instagram } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SITE_ADDRESS_LINES,
  SITE_EMAIL,
  SITE_PHONE_DISPLAY,
  SITE_PHONE_TEL,
  SITE_SOCIAL,
} from "@/lib/site";

export default function SiteFooter() {
  const { t } = useTranslation();
  return (
    <footer className="site-footer">
      {/* Contact band: the main action, full width above the link columns. */}
      <div className="footer-band">
        <div className="footer-band__text">
          <span className="footer-label">{t("footer.start")}</span>
          <p className="footer-band__title">{t("footer.bandTitle")}</p>
          <div className="footer-band__details">
            <a className="footer-phone" href={`tel:${SITE_PHONE_TEL}`}>
              {SITE_PHONE_DISPLAY}
            </a>
            <a href={`mailto:${SITE_EMAIL}`}>{SITE_EMAIL}</a>
            <span className="footer-address">{SITE_ADDRESS_LINES.join(", ")}</span>
          </div>
        </div>
        <Link className="footer-band__cta" to="/contact">
          {t("footer.contactCta")} <ArrowRight size={16} aria-hidden />
        </Link>
      </div>

      <div className="footer-main">
        <div className="footer-brand">
          <Link className="brand brand-light" to="/" aria-label={t("brand.ariaHome")}>
            <img className="brand-logo brand-logo-footer" src="/logos/groundwork-logo-white.png" alt={t("brand.name")} />
          </Link>
          <p className="footer-tagline">{t("footer.tagline")}</p>
          <p className="footer-intro">{t("footer.intro")}</p>
          <div className="footer-social" aria-label={t("footer.socialAria")}>
            <a href={SITE_SOCIAL.instagram} target="_blank" rel="noopener noreferrer" aria-label={t("footer.instagramAria")}>
              <Instagram size={18} strokeWidth={1.75} aria-hidden />
            </a>
          </div>
        </div>
        <nav className="footer-cols" aria-label={t("footer.navAria")}>
          <div className="footer-links">
            <span className="footer-label">{t("footer.explore")}</span>
            <Link to="/about">{t("nav.about")}</Link>
            <Link to="/partners">{t("nav.partners")}</Link>
            <Link to="/events">{t("nav.events")}</Link>
            <Link to="/contact">{t("nav.contact")}</Link>
            <a href="/#adu-financing">{t("nav.adu")}</a>
            <a href="/get-credit-report">{t("footer.cta")}</a>
          </div>
          <div className="footer-links">
            <span className="footer-label">{t("legal.footerLabel")}</span>
            <Link to="/terms">{t("legal.title_terms")}</Link>
            <Link to="/privacy">{t("legal.title_privacy")}</Link>
            <Link to="/refund-policy">{t("legal.title_refunds")}</Link>
          </div>
          <div className="footer-links">
            <span className="footer-label">{t("footer.portals")}</span>
            <Link to="/admin/login">{t("footer.portalAdmin")}</Link>
            <Link to="/affiliate/login">{t("footer.portalAffiliate")}</Link>
            <Link to="/contractor/login">{t("footer.portalContractor")}</Link>
            <Link to="/city/login">{t("footer.portalCity")}</Link>
          </div>
        </nav>
      </div>

      <div className="footer-bottom">
        <p>
          © {new Date().getFullYear()} {t("brand.name")} · {t("footer.legal")}
        </p>
        <p className="footer-bottom__disclaimer">{t("footer.disclaimer")}</p>
        <a href="#top">{t("footer.top")}</a>
      </div>
    </footer>
  );
}
