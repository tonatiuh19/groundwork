import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Expand, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Full-viewport video lightbox for the home commercial.
 * Escape / backdrop / close dismiss; body scroll locked; plays with controls while open.
 */
export default function VideoLightbox({
  open,
  src,
  poster,
  title,
  onClose,
}: {
  open: boolean;
  src: string;
  poster?: string;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.requestAnimationFrame(() => {
      closeRef.current?.focus();
      const video = videoRef.current;
      if (video) {
        video.muted = true;
        void video.play().catch(() => undefined);
      }
    });

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      videoRef.current?.pause();
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="video-lightbox-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="video-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="video-lightbox-bar">
          <p id={titleId} className="video-lightbox-title">
            <Expand size={16} aria-hidden /> {title}
          </p>
          <button
            ref={closeRef}
            type="button"
            className="video-lightbox-close"
            onClick={onClose}
            aria-label={t("hero.closeVideo")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="video-lightbox-stage">
          <video
            ref={videoRef}
            className="video-lightbox-player"
            controls
            playsInline
            muted
            loop
            preload="metadata"
            poster={poster}
            aria-label={title}
          >
            <source src={src} type="video/mp4" />
          </video>
        </div>
      </div>
    </div>,
    document.body,
  );
}
