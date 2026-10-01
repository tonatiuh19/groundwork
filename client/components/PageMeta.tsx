import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

/** Public site origin (no trailing slash). Same env as the API — never leak localhost into share cards. */
export function getSiteUrl(): string {
  const fromEnv = String(import.meta.env.PUBLIC_APP_URL || "").trim();
  if (/^https?:\/\//i.test(fromEnv)) {
    return fromEnv.replace(/\/$/, "");
  }
  return "https://groundworkcapitalgroup.com";
}

export const SITE_NAME = "Groundwork Capital";
export const SITE_NAME_LEGAL = "Groundwork Capital Group";
export const THEME_COLOR = "#0e2a4a";

const BASE_URL = getSiteUrl();
const DEFAULT_IMAGE = `${BASE_URL}/logos/groundwork-logo.png`;

export type OgType = "website" | "article" | "product" | "profile";

export interface PageMetaProps {
  /** Tab + OG title. Appends " | Groundwork Capital" unless `titleFull`. */
  title: string;
  /** Plain-text description (~120–160 chars for SEO). */
  description: string;
  /** Canonical path, e.g. "/" or "/get-credit-report". Absolute URLs also accepted. */
  canonical?: string;
  /** Absolute OG/Twitter image URL. Defaults to brand logo. */
  image?: string;
  /** Explicit OG image dimensions (omit when unknown). */
  imageWidth?: number;
  imageHeight?: number;
  /** Image alt for OG (defaults to site + title). */
  imageAlt?: string;
  /** Skip site-name suffix when title already includes the brand. */
  titleFull?: boolean;
  ogType?: OgType;
  /** Unlisted / auth / utility pages. */
  noIndex?: boolean;
  /** Comma-separated or array of keywords. */
  keywords?: string | string[];
  /** Open Graph article timestamps (ISO). */
  publishedTime?: string;
  modifiedTime?: string;
  /** Extra robots directives when indexed (merged with defaults). */
  robotsExtra?: string;
  /** JSON-LD object(s). */
  jsonLd?: object | object[];
  /** Override html/og locale (defaults from i18n). */
  locale?: "en" | "es";
}

function toAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${BASE_URL}${path}`;
}

function normalizeKeywords(keywords?: string | string[]): string | undefined {
  if (!keywords) return undefined;
  const list = Array.isArray(keywords) ? keywords : keywords.split(",");
  const cleaned = list.map((k) => k.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : undefined;
}

export default function PageMeta({
  title,
  description,
  canonical,
  image = DEFAULT_IMAGE,
  imageWidth,
  imageHeight,
  imageAlt,
  titleFull = false,
  ogType = "website",
  noIndex = false,
  keywords,
  publishedTime,
  modifiedTime,
  robotsExtra,
  jsonLd,
  locale: localeProp,
}: PageMetaProps) {
  const { i18n, t } = useTranslation();
  const lang: "en" | "es" =
    localeProp ?? (i18n.language?.startsWith("es") ? "es" : "en");
  const ogLocale = lang === "es" ? "es_ES" : "en_US";
  const ogLocaleAlt = lang === "es" ? "en_US" : "es_ES";

  const fullTitle = titleFull ? title : `${title} | ${SITE_NAME}`;
  const canonicalUrl = canonical
    ? toAbsoluteUrl(canonical)
    : typeof window !== "undefined"
      ? `${BASE_URL}${window.location.pathname || "/"}`
      : BASE_URL;

  const imageUrl = toAbsoluteUrl(image);
  const imageType = /\.jpe?g(\?|$)/i.test(imageUrl)
    ? "image/jpeg"
    : /\.webp(\?|$)/i.test(imageUrl)
      ? "image/webp"
      : /\.gif(\?|$)/i.test(imageUrl)
        ? "image/gif"
        : "image/png";
  const isDefaultImage = imageUrl === DEFAULT_IMAGE;
  const resolvedWidth = imageWidth ?? (isDefaultImage ? 378 : undefined);
  const resolvedHeight = imageHeight ?? (isDefaultImage ? 106 : undefined);
  const resolvedImageAlt =
    imageAlt || `${SITE_NAME} – ${title}`;
  const keywordContent = normalizeKeywords(keywords);
  const robots = noIndex
    ? "noindex,nofollow"
    : [
        "index",
        "follow",
        "max-snippet:-1",
        "max-image-preview:large",
        "max-video-preview:-1",
        robotsExtra,
      ]
        .filter(Boolean)
        .join(",");

  const schemas = jsonLd
    ? Array.isArray(jsonLd)
      ? jsonLd
      : [jsonLd]
    : [];

  return (
    <Helmet prioritizeSeoTags>
      <html lang={lang} />

      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywordContent ? (
        <meta name="keywords" content={keywordContent} />
      ) : null}
      <meta name="author" content={SITE_NAME_LEGAL} />
      <meta name="application-name" content={SITE_NAME} />
      <meta name="theme-color" content={THEME_COLOR} />
      <meta name="color-scheme" content="light" />
      <meta name="format-detection" content="telephone=yes" />
      <link rel="canonical" href={canonicalUrl} />
      <link rel="alternate" hrefLang="en" href={canonicalUrl} />
      <link rel="alternate" hrefLang="es" href={canonicalUrl} />
      <link rel="alternate" hrefLang="x-default" href={canonicalUrl} />

      <meta name="robots" content={robots} />
      <meta name="googlebot" content={robots} />

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:secure_url" content={imageUrl} />
      <meta property="og:image:type" content={imageType} />
      {resolvedWidth != null ? (
        <meta property="og:image:width" content={String(resolvedWidth)} />
      ) : null}
      {resolvedHeight != null ? (
        <meta property="og:image:height" content={String(resolvedHeight)} />
      ) : null}
      <meta property="og:image:alt" content={resolvedImageAlt} />
      <meta property="og:locale" content={ogLocale} />
      <meta property="og:locale:alternate" content={ogLocaleAlt} />
      {publishedTime ? (
        <meta property="article:published_time" content={publishedTime} />
      ) : null}
      {modifiedTime ? (
        <meta property="article:modified_time" content={modifiedTime} />
      ) : null}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
      <meta name="twitter:image:alt" content={resolvedImageAlt} />

      <meta
        name="apple-mobile-web-app-title"
        content={t("brand.name", { defaultValue: SITE_NAME })}
      />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta
        name="apple-mobile-web-app-status-bar-style"
        content="default"
      />

      {schemas.map((schema, i) => (
        <script key={`ld-${i}`} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}

/* ── JSON-LD helpers ─────────────────────────────────────────────────────── */

export function organizationSchema(lang: "en" | "es" = "en") {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME_LEGAL,
    alternateName: SITE_NAME,
    url: BASE_URL,
    logo: `${BASE_URL}/logos/groundwork-logo.png`,
    description:
      lang === "es"
        ? "Socio de financiamiento ADU para propietarios que ayuda a liberar ingresos del patio con un camino claro para construir."
        : "Homeowner ADU financing partner helping families unlock backyard income with a clear path to build.",
    areaServed: {
      "@type": "Country",
      name: "United States",
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "info@groundworkcapitalgroup.com",
      availableLanguage: ["English", "Spanish"],
    },
  };
}

export function financialServiceSchema(lang: "en" | "es" = "en") {
  return {
    "@context": "https://schema.org",
    "@type": "FinancialService",
    name: SITE_NAME_LEGAL,
    description:
      lang === "es"
        ? "Orientación de financiamiento ADU para propietarios — revisión de crédito soft-pull y un camino más simple de la idea al proyecto."
        : "ADU financing guidance for homeowners — soft-pull credit check and a simpler path from backyard idea to build.",
    url: BASE_URL,
    logo: `${BASE_URL}/logos/groundwork-logo.png`,
    areaServed: "US",
    availableLanguage: ["English", "Spanish"],
    priceRange: "$$",
  };
}

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: BASE_URL,
  inLanguage: ["en", "es"],
  publisher: {
    "@type": "Organization",
    name: SITE_NAME_LEGAL,
    url: BASE_URL,
  },
};

export const faqSchema = (items: { question: string; answer: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
});

export const breadcrumbSchema = (
  crumbs: { name: string; path: string }[],
) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.name,
    item: toAbsoluteUrl(c.path),
  })),
});

export const webPageSchema = (opts: {
  name: string;
  description: string;
  path: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: opts.name,
  description: opts.description,
  url: toAbsoluteUrl(opts.path),
  isPartOf: { "@type": "WebSite", name: SITE_NAME, url: BASE_URL },
  inLanguage: ["en", "es"],
});
