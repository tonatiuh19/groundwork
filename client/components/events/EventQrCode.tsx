import { useEffect, useState } from "react";
import { brandQrSvg } from "@/lib/brandQr";

/** Scannable branded QR (inline SVG, logo in the middle) for any URL. */
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
    brandQrSvg(url)
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
      // Generated locally by `qrcode` from our own URL (no user HTML).
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
