import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Check, Copy, Download, FileText, MousePointerClick, QrCode, Sparkles, Users } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAffiliateLink } from "@/store/slices/affiliateLinkSlice";
import EventQrCode from "@/components/events/EventQrCode";
import { downloadBrandQr } from "@/lib/brandQr";
import { Loading } from "@/components/portal/kit";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/cn";

type LinkLang = "en" | "es";

/**
 * The affiliate's link as a branded "business card": short link, EN/ES
 * toggle, one-tap copy, QR, flyer, and how the link is doing.
 * variant "hero" (dashboard / link page) or "compact" (header popover).
 */
export default function AffiliateLinkCard({ variant = "hero" }: { variant?: "hero" | "compact" }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { info, loading } = useAppSelector((s) => s.affiliateLink);
  const me = useAppSelector((s) => s.portalAuth.affiliate.user);
  const [lang, setLang] = useState<LinkLang>(i18n.language?.startsWith("es") ? "es" : "en");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!info) void dispatch(fetchAffiliateLink());
  }, [dispatch, info]);

  if (!info) return loading ? <Loading /> : null;
  // One link for everyone: the landing asks visitors whether they're a homeowner or a partner.
  const url = info.urls[lang];
  const shown = `${info.display}${lang === "es" ? "?lang=es" : ""}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the link is selectable */
    }
  };
  const name = info.slug || info.referral_code;
  const downloadQr = async (kind: "png" | "svg") => {
    try {
      await downloadBrandQr(url, kind, `groundwork-${name}-${lang}-qr`);
    } catch (e) {
      logger.warn("QR download failed", e);
    }
  };

  return (
    <section className={cn("gw-linkcard", `gw-linkcard--${variant}`)} aria-label={t("affLink.cardAria")}>
      <div className="gw-linkcard__face">
        <div className="gw-linkcard__top">
          <span className="gw-linkcard__eyebrow">
            <Sparkles size={13} aria-hidden /> {t("affLink.eyebrow")}
          </span>
          <div className="gw-linkcard__lang" role="radiogroup" aria-label={t("affLink.langAria")}>
            {(["en", "es"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} className={cn(lang === l && "is-on")} onClick={() => setLang(l)}>
                {l === "en" ? "EN" : "ES"}
              </button>
            ))}
          </div>
        </div>
        <p className="gw-linkcard__name">{me ? `${me.first_name} ${me.last_name}`.trim() : ""}</p>
        <button type="button" className="gw-linkcard__url" onClick={() => void copy()} title={t("affLink.copy")}>
          <span>{shown}</span>
          <span className={cn("gw-linkcard__copy", copied && "is-done")}>
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? t("affLink.copied") : t("affLink.copy")}
          </span>
        </button>
        <p className="gw-linkcard__hint">
          {t("affLink.linkHint")} {lang === "es" ? t("affLink.hintEs") : t("affLink.hintEn")}
        </p>
        {variant === "hero" ? (
          <dl className="gw-linkcard__stats">
            <div>
              <dt>
                <MousePointerClick size={13} aria-hidden /> {t("affLink.clicks7d")}
              </dt>
              <dd>{info.stats.clicks_7d}</dd>
            </div>
            <div>
              <dt>{t("affLink.clicksTotal")}</dt>
              <dd>{info.stats.clicks_total}</dd>
            </div>
            <div>
              <dt>
                <Users size={13} aria-hidden /> {t("affLink.leads")}
              </dt>
              <dd>{info.stats.leads}</dd>
            </div>
            <div>
              <dt>{t("affLink.clients")}</dt>
              <dd>{info.stats.clients}</dd>
            </div>
          </dl>
        ) : null}
      </div>
      <div className="gw-linkcard__side">
        <div className="gw-linkcard__qr">
          <EventQrCode url={url} label={t("affLink.qrAria", { url: shown })} />
        </div>
        <div className="gw-linkcard__actions">
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => void downloadQr("png")}>
            <QrCode size={14} aria-hidden /> PNG
          </button>
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => void downloadQr("svg")}>
            <Download size={14} aria-hidden /> SVG
          </button>
          <a className="pf-btn pf-btn--sm pf-btn--gold" href={`/api/affiliate/link/flyer?lang=${lang}`} target="_blank" rel="noreferrer">
            <FileText size={14} aria-hidden /> {t("affLink.flyer")}
          </a>
          {variant === "compact" ? (
            <Link className="pf-btn pf-btn--sm" to="/affiliate/link">
              <ArrowUpRight size={14} aria-hidden /> {t("affLink.more")}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
