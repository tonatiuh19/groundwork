import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { LegalSlug } from "@shared/api";
import { LEGAL_PATHS } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLegalPage } from "@/store/slices/legalSlice";
import PageMeta from "@/components/PageMeta";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AgreementDocument from "@/components/affiliate/AgreementDocument";
import { Loading } from "@/components/portal/kit";
import { cn } from "@/lib/cn";

const SLUGS: LegalSlug[] = ["terms", "privacy", "refunds"];

/** /terms, /privacy, /refund-policy: the latest published version, in the reader's language. */
export default function LegalPage({ slug }: { slug: LegalSlug }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const lang: "en" | "es" = i18n.language?.startsWith("es") ? "es" : "en";
  const page = useAppSelector((s) => s.legal.pages[`${slug}:${lang}`]);
  const loading = useAppSelector((s) => s.legal.pageLoading);

  useEffect(() => {
    void dispatch(fetchLegalPage({ slug, lang }));
  }, [dispatch, slug, lang]);

  return (
    <div className="groundwork-page">
      <PageMeta title={page?.title || t(`legal.title_${slug}`)} description={t(`legal.meta_${slug}`)} canonical={LEGAL_PATHS[slug]} />
      <SiteHeader />
      <main id="top" className="legal-page section-shell">
        <nav className="legal-tabs" aria-label={t("legal.nav")}>
          {SLUGS.map((s) => (
            <Link key={s} to={LEGAL_PATHS[s]} className={cn("legal-tab", s === slug && "is-active")} aria-current={s === slug ? "page" : undefined}>
              {t(`legal.title_${s}`)}
            </Link>
          ))}
        </nav>
        <article className="legal-card">
          {page ? (
            <>
              <AgreementDocument body={page.body} />
              <p className="legal-version">{t("legal.version", { version: page.version })}</p>
            </>
          ) : loading ? (
            <Loading />
          ) : (
            <div className="legal-missing">
              <h1>{t(`legal.title_${slug}`)}</h1>
              {/* Any failure (not published yet, offline, server error): the same friendly note with the phone number. */}
              <p>{t("legal.notPublished")}</p>
            </div>
          )}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
