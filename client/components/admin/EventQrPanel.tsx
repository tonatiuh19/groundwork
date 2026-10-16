import { useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, QrCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MarketingEvent } from "@shared/api";
import EventQrCode, { QR_OPTIONS } from "@/components/events/EventQrCode";
import { BusyButton } from "@/components/portal/kit";
import { eventQrUrl } from "@/lib/eventQr";
import { useFormatters } from "@/lib/format";
import { logger } from "@/utils/logger";

function saveFile(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Admin "Registration QR": the flyer QR for `/e/<slug>` (tracked — forwards to
 * the next open event once this one is over), PNG/SVG downloads and scan stats.
 */
export default function EventQrPanel({ event }: { event: MarketingEvent }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const url = eventQrUrl(event.slug);
  const [copied, setCopied] = useState(false);
  const published = event.status === "published";

  const downloadPng = async () => {
    try {
      saveFile(await QRCode.toDataURL(url, { ...QR_OPTIONS, width: 1600 }), `groundwork-event-${event.slug}-qr.png`);
    } catch (e) {
      logger.error("eventQr", e);
    }
  };
  const downloadSvg = async () => {
    try {
      const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
      const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      saveFile(href, `groundwork-event-${event.slug}-qr.svg`);
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      logger.error("eventQr", e);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      logger.warn("eventQr", e);
    }
  };

  return (
    <section className="pf-section gw-event-qr">
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <QrCode size={18} aria-hidden /> {t("admin.eventQrTitle")}
        </h2>
      </div>
      <div className="gw-event-qr-body">
        <EventQrCode url={url} label={t("admin.eventQrAria", { title: event.title_en })} className="gw-event-qr-code" />
        <div className="gw-event-qr-info">
          <p className="pf-hint">{t("admin.eventQrHint")}</p>
          {!published ? <p className="pf-hint gw-event-qr-warn">{t("admin.eventQrDraft")}</p> : null}
          <code className="gw-event-qr-url">{url}</code>
          <div className="gw-event-qr-actions">
            <BusyButton tone="gold" icon={Download} label={t("admin.eventQrPng")} onClick={() => void downloadPng()} />
            <BusyButton icon={Download} label={t("admin.eventQrSvg")} onClick={() => void downloadSvg()} />
            <BusyButton
              icon={Copy}
              label={t(copied ? "admin.eventQrCopied" : "admin.eventQrCopy")}
              onClick={() => void copy()}
            />
          </div>
          <dl className="gw-event-qr-stats">
            <div>
              <dt>{t("admin.eventQrScans")}</dt>
              <dd>{event.qr_scan_count ?? 0}</dd>
            </div>
            <div>
              <dt>{t("admin.eventQrRsvps")}</dt>
              <dd>{event.qr_rsvp_count ?? 0}</dd>
            </div>
            <div>
              <dt>{t("admin.eventQrLastScan")}</dt>
              <dd>{event.qr_last_scanned_at ? fmt.eventDateTime(event.qr_last_scanned_at) : "—"}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
