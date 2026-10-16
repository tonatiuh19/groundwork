import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Brand QR colors: navy modules on white (high contrast for phone cameras). */
export const QR_COLORS = { dark: "#0e2a4a", light: "#ffffff" } as const;
export const QR_OPTIONS = { errorCorrectionLevel: "M" as const, margin: 2, color: QR_COLORS };

/** Scannable QR (inline SVG) for any URL. */
export default function EventQrCode({
  url,
  label,
  className,
}: {
  url: string;
  label: string;
  className?: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { ...QR_OPTIONS, type: "svg" })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div
      className={`event-qr${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={label}
      // Generated locally by `qrcode` from our own URL — no user HTML.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
