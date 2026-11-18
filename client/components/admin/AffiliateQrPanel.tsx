import { useState } from "react";
import { Copy, Download, QrCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import EventQrCode from "@/components/events/EventQrCode";
import { downloadBrandQr } from "@/lib/brandQr";
import { buildAffiliateTrackingUrl } from "@/lib/referral";
import { BusyButton } from "@/components/portal/kit";
import { logger } from "@/utils/logger";

/**
 * Staff affiliate page: the branded QR of the affiliate's tracking link (same one they see in
 * their portal), ready to download and send them. Scans count as link clicks.
 */
export default function AffiliateQrPanel({ slug, referralCode, name }: { slug?: string | null; referralCode: string; name: string }) {
  const { t } = useTranslation();
  const url = buildAffiliateTrackingUrl({ referral_code: referralCode, slug });
  const fileBase = `groundwork-${String(slug || referralCode).trim()}-qr`;
  const [copied, setCopied] = useState(false);

  const download = async (kind: "png" | "svg") => {
    try {
      await downloadBrandQr(url, kind, fileBase);
    } catch (e) {
      logger.error("affiliateQr", e);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      logger.warn("affiliateQr", e);
    }
  };

  return (
    <section className="pf-section gw-event-qr">
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <QrCode size={18} aria-hidden /> {t("affQr.title")}
        </h2>
      </div>
      <div className="gw-event-qr-body">
        <EventQrCode url={url} label={t("affQr.aria", { name })} className="gw-event-qr-code" />
        <div className="gw-event-qr-info">
          <p className="pf-hint">{t("affQr.hint")}</p>
          <code className="gw-event-qr-url">{url}</code>
          <div className="gw-event-qr-actions">
            <BusyButton tone="gold" icon={Download} label={t("admin.eventQrPng")} onClick={() => void download("png")} />
            <BusyButton icon={Download} label={t("admin.eventQrSvg")} onClick={() => void download("svg")} />
            <BusyButton icon={Copy} label={t(copied ? "admin.eventQrCopied" : "affQr.copy")} onClick={() => void copy()} />
          </div>
        </div>
      </div>
    </section>
  );
}
