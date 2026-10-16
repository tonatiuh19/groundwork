import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Mail, MessageSquare, PencilLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAffiliateOverview } from "@/store/slices/affiliatePortalSlice";
import { CopyButton, ErrorNote, Loading, PageHeader } from "@/components/portal/kit";
import { buildAffiliateTrackingUrl } from "@/lib/referral";
import AffiliateLinkCard from "@/components/affiliate/AffiliateLinkCard";
import { clearLinkError, saveAffiliateSlug } from "@/store/slices/affiliateLinkSlice";
import { slugifyAffiliate } from "@/lib/affiliateSlug";
import { BusyButton } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

const ADVANCED_LANDINGS = ["get-credit-report", "partners", "contact"] as const;

export default function TrackingLink() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { overview, loading, error } = useAppSelector((s) => s.affiliatePortal);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fmt = useFormatters();
  const link = useAppSelector((s) => s.affiliateLink);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugSaved, setSlugSaved] = useState(false);
  useEffect(() => {
    if (link.info) setSlugDraft(link.info.slug || "");
  }, [link.info]);
  const cleanSlug = slugifyAffiliate(slugDraft);
  const lockedUntil = link.info?.can_change_slug_at ?? null;
  const [landing, setLanding] =
    useState<(typeof ADVANCED_LANDINGS)[number]>("get-credit-report");

  useEffect(() => {
    void dispatch(fetchAffiliateOverview());
  }, [dispatch]);

  const defaultUrl = useMemo(() => {
    if (!overview) return "";
    return buildAffiliateTrackingUrl({
      referral_code: overview.affiliate.referral_code,
      slug: overview.affiliate.slug,
    });
  }, [overview]);

  const advancedUrl = useMemo(() => {
    if (!overview) return "";
    return buildAffiliateTrackingUrl({
      referral_code: overview.affiliate.referral_code,
      slug: overview.affiliate.slug,
      landing,
    });
  }, [overview, landing]);

  const shareUrl = advancedOpen ? advancedUrl : defaultUrl;
  const message = t("aff.shareMessage", { url: shareUrl });

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.trackingLink" leadKey="aff.linkLead" />
      <AffiliateLinkCard />

      {link.info ? (
        <section className="pf-card gw-slug-editor">
          <h2 className="pf-h2">
            <PencilLine size={16} aria-hidden /> {t("affLink.nameTitle")}
          </h2>
          <p className="pf-muted">{t("affLink.nameLead")}</p>
          <div className="gw-slug-editor__row">
            <span className="gw-slug-editor__prefix">{link.info.display.replace(/\/r\/.*$/, "")}/r/</span>
            <input
              value={slugDraft}
              maxLength={64}
              aria-label={t("affLink.nameTitle")}
              disabled={Boolean(lockedUntil) || link.saving}
              onChange={(e) => {
                setSlugDraft(e.target.value);
                setSlugSaved(false);
                dispatch(clearLinkError());
              }}
            />
            <BusyButton
              tone="gold"
              label={t("pf.save")}
              doneLabel={t("affLink.nameSaved")}
              done={slugSaved}
              busy={link.saving}
              disabled={Boolean(lockedUntil) || !cleanSlug || cleanSlug === (link.info.slug || "")}
              onClick={() =>
                void dispatch(saveAffiliateSlug(cleanSlug)).then((r) => {
                  if (saveAffiliateSlug.fulfilled.match(r)) {
                    setSlugSaved(true);
                    void dispatch(fetchAffiliateOverview());
                  }
                })
              }
            />
          </div>
          {cleanSlug && cleanSlug !== slugDraft ? <p className="pf-hint">{t("affLink.namePreview", { slug: cleanSlug })}</p> : null}
          <ErrorNote error={link.error} />
          <p className="pf-hint">
            {lockedUntil ? t("affLink.nameLocked", { date: fmt.date(lockedUntil) }) : t("affLink.nameRules")}
          </p>
        </section>
      ) : null}

      <ErrorNote error={error} />
      {loading && !overview ? <Loading /> : null}
      {overview ? (
        <section className="pf-card">
          <h2 className="pf-h2">{t("affLink.moreWays")}</h2>
          <p className="pf-muted">{t("aff.linkDefaultHint")}</p>
          <code className="pf-code">{defaultUrl}</code>
          <div className="pf-actions">
            <CopyButton value={shareUrl} />
            <a
              className="pf-btn"
              href={`mailto:?subject=${encodeURIComponent(t("aff.shareSubject"))}&body=${encodeURIComponent(message)}`}
            >
              <Mail size={15} /> {t("aff.shareEmail")}
            </a>
            <a
              className="pf-btn"
              href={`sms:?&body=${encodeURIComponent(message)}`}
            >
              <MessageSquare size={15} /> {t("aff.shareSms")}
            </a>
          </div>

          <div className="pf-advanced">
            <button
              type="button"
              className="pf-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
            >
              <ChevronDown
                size={16}
                className={advancedOpen ? "pf-chevron-open" : undefined}
                aria-hidden
              />
              {t("aff.advancedLink")}
            </button>
            {advancedOpen ? (
              <div className="pf-advanced-body">
                <label className="pf-field">
                  <span>{t("aff.landing")}</span>
                  <select
                    value={landing}
                    onChange={(e) =>
                      setLanding(e.target.value as (typeof ADVANCED_LANDINGS)[number])
                    }
                  >
                    {ADVANCED_LANDINGS.map((l) => (
                      <option key={l} value={l}>
                        {t(`aff.landings.${l}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <code className="pf-code">{advancedUrl}</code>
                <p className="pf-muted">{t("aff.advancedHint")}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
