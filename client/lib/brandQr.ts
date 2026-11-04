import QRCode from "qrcode";

/** Brand QR colors: navy modules on white (high contrast for phone cameras). */
export const QR_COLORS = { dark: "#0e2a4a", light: "#ffffff" } as const;
/** High error correction (30%) so the centered logo never blocks a scan. */
export const QR_OPTIONS = { errorCorrectionLevel: "H" as const, margin: 2, color: QR_COLORS };

/** Logo mark size as a share of the QR width (≈5% of the area, well under the H budget). */
const LOGO_SHARE = 0.22;
const MARK_URL = "/logos/groundwork-mark.png";

let markDataUrl: Promise<string | null> | null = null;
/** The square logo mark as a data URL (embedded so downloaded SVGs work offline). */
function loadMark(): Promise<string | null> {
  markDataUrl ??= fetch(MARK_URL)
    .then((r) => (r.ok ? r.blob() : null))
    .then(
      (b) =>
        b &&
        new Promise<string | null>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
          fr.onerror = () => resolve(null);
          fr.readAsDataURL(b);
        }),
    )
    .catch(() => null)
    .then((v) => {
      if (!v) markDataUrl = null; // retry next time instead of caching a failure
      return v;
    });
  return markDataUrl;
}

/** Branded QR as SVG markup: navy modules, white plate + Groundwork mark in the middle. */
export async function brandQrSvg(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
  const mark = await loadMark();
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  if (!mark || !vb) return svg;
  const n = Number(vb[1]);
  const size = n * LOGO_SHARE;
  const pad = size * 0.14;
  const at = (n - size) / 2;
  const overlay =
    `<rect x="${at - pad}" y="${at - pad}" width="${size + pad * 2}" height="${size + pad * 2}" rx="${pad}" fill="${QR_COLORS.light}"/>` +
    `<image href="${mark}" x="${at}" y="${at}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
  return svg.replace(/<\/svg>\s*$/, `${overlay}</svg>`);
}

/** Branded QR as a PNG data URL (print size by default). */
export async function brandQrPng(url: string, width = 1600): Promise<string> {
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, url, { ...QR_OPTIONS, width });
  const mark = await loadMark();
  const ctx = canvas.getContext("2d");
  if (!mark || !ctx) return canvas.toDataURL("image/png");
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = mark;
  });
  if (!img) return canvas.toDataURL("image/png");
  const n = canvas.width;
  const size = n * LOGO_SHARE;
  const pad = size * 0.14;
  const at = (n - size) / 2;
  ctx.fillStyle = QR_COLORS.light;
  ctx.beginPath();
  // roundRect is missing on older Safari: fall back to a square plate.
  if (typeof ctx.roundRect === "function") ctx.roundRect(at - pad, at - pad, size + pad * 2, size + pad * 2, pad);
  else ctx.rect(at - pad, at - pad, size + pad * 2, size + pad * 2);
  ctx.fill();
  ctx.drawImage(img, at, at, size, size);
  return canvas.toDataURL("image/png");
}

/** Trigger a browser download for a data/blob URL. */
export function saveFile(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download the branded QR for `url` as PNG or SVG. */
export async function downloadBrandQr(url: string, kind: "png" | "svg", baseName: string) {
  if (kind === "png") return saveFile(await brandQrPng(url), `${baseName}.png`);
  const href = URL.createObjectURL(new Blob([await brandQrSvg(url)], { type: "image/svg+xml" }));
  saveFile(href, `${baseName}.svg`);
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
