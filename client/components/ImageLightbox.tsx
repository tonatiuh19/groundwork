import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Full-viewport image lightbox for public pages (floor plans, etc.).
 * Escape / backdrop / close button dismiss; body scroll locked while open.
 */
export default function ImageLightbox({
  open,
  src,
  alt,
  onClose,
  children,
}: {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
  /** Custom content (e.g. a designed card) instead of the plain image. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
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
    window.requestAnimationFrame(() => closeRef.current?.focus());

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="image-lightbox-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="image-lightbox-bar">
          <p id={titleId} className="image-lightbox-title">
            <ZoomIn size={16} aria-hidden /> {alt}
          </p>
          <button
            ref={closeRef}
            type="button"
            className="image-lightbox-close"
            onClick={onClose}
            aria-label={t("options.closeLightbox")}
          >
            <X size={20} />
          </button>
        </div>
        <div className={children ? "image-lightbox-stage image-lightbox-stage--custom" : "image-lightbox-stage"}>
          {children ?? <img src={src} alt={alt} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
