import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageMeta from "@/components/PageMeta";
import LanguageSwitcher from "@/components/LanguageSwitcher";

/** Split brand-stage + card layout shared by public portal onboarding pages. */
export default function AuthStage({
  accent,
  titleKey,
  leadKey,
  pointKeys,
  canonical,
  children,
}: {
  accent: "ink" | "gold" | "pine" | "clay";
  titleKey: string;
  leadKey: string;
  pointKeys: string[];
  canonical: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={`portal-login portal-login--${accent}`}>
      <PageMeta title={t(titleKey)} description={t(leadKey)} canonical={canonical} noIndex />
      <div className="portal-login-stage">
        <aside className="portal-login-brand">
          <Link to="/" className="portal-login-logo">
            <img src="/logos/groundwork-logo.png" alt="Groundwork Capital" />
          </Link>
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("portalAuth.eyebrow")}
          </p>
          <h1>{t(titleKey)}</h1>
          <p>{t(leadKey)}</p>
          <ul className="portal-login-points">
            {pointKeys.map((k) => (
              <li key={k}>
                <ShieldCheck size={16} /> {t(k)}
              </li>
            ))}
          </ul>
        </aside>
        <section className="portal-login-card">
          <div className="portal-login-card-top">
            <LanguageSwitcher />
          </div>
          {children}
        </section>
      </div>
    </div>
  );
}
