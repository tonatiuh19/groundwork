import { useCallback, useState } from "react";
import { Film, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PublicEventMedia } from "@shared/api";
import ImageLightbox from "@/components/ImageLightbox";

/** Embedded reel (Instagram / YouTube / TikTok) or uploaded video. */
export function EventVideo({ media, title }: { media: PublicEventMedia; title: string }) {
  if (media.kind === "embed") {
    return (
      <div className={`event-embed event-embed--${media.embed_provider || "video"}`}>
        <iframe
          src={media.url}
          title={media.caption || title}
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  return (
    <video className="event-video" src={media.url} controls playsInline preload="metadata">
      <track kind="captions" />
    </video>
  );
}

/**
 * Past-event highlights: the highlight reel on top, then a responsive grid of
 * photos (lightbox) and other videos. Empty → "Highlights coming soon".
 */
export default function EventMediaGallery({
  media,
  title,
}: {
  media: PublicEventMedia[];
  title: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<PublicEventMedia | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const reel = media.find((m) => m.is_highlight && m.kind !== "photo") || null;
  const rest = media.filter((m) => m !== reel);
  const photos = rest.filter((m) => m.kind === "photo");
  const videos = rest.filter((m) => m.kind !== "photo");

  if (!media.length) {
    return (
      <section className="event-media section-shell">
        <div className="event-media-empty">
          <Film size={28} aria-hidden />
          <h2>{t("events.highlightsSoon")}</h2>
          <p>{t("events.highlightsSoonBody")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="event-media section-shell" aria-label={t("events.highlights")}>
      <p className="eyebrow">
        <span className="eyebrow-line" /> {t("events.highlights")}
      </p>
      {reel ? (
        <figure className="event-reel">
          <EventVideo media={reel} title={title} />
          {reel.caption ? <figcaption>{reel.caption}</figcaption> : null}
        </figure>
      ) : null}

      {videos.length ? (
        <div className="event-video-grid">
          {videos.map((m) => (
            <figure key={m.id}>
              <EventVideo media={m} title={title} />
              {m.caption ? <figcaption>{m.caption}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : null}

      {photos.length ? (
        <>
          <h2 className="event-media-title">{t("events.gallery", { count: photos.length })}</h2>
          <ul className="event-gallery">
            {photos.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setOpen(m)} aria-label={m.caption || t("events.openPhoto")}>
                  <img src={m.url} alt={m.caption || title} loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <ImageLightbox open={!!open} src={open?.url || ""} alt={open?.caption || title} onClose={close} />
    </section>
  );
}

/** Small "reel" badge for list cards. */
export function MediaBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span className="event-media-badge">
      <Play size={11} aria-hidden /> {t("events.mediaCount", { count })}
    </span>
  );
}
