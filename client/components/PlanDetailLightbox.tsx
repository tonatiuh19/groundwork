import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Layers, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Stacked 3D + CAD plan detail lightbox for ADU Options.
 * Escape / backdrop / close dismiss; body scroll locked while open.
 */
export default function PlanDetailLightbox({
  open,
  title,
  threeDSrc,
  threeDAlt,
  cadSrc,
  cadAlt,
  onClose,
}: {
  open: boolean;
  title: string;
  threeDSrc: string;
  threeDAlt: string;
  cadSrc: string;
  cadAlt: string;
  onClose: () => void;
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
        className="image-lightbox plan-detail-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="image-lightbox-bar">
          <p id={titleId} className="image-lightbox-title">
            <Layers size={16} aria-hidden /> {title}
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
        <div className="image-lightbox-stage plan-detail-stage">
          <figure className="plan-detail-block">
            <figcaption>{t("options.detail3dLabel")}</figcaption>
            <img src={threeDSrc} alt={threeDAlt} />
          </figure>
          <figure className="plan-detail-block">
            <figcaption>{t("options.detailCadLabel")}</figcaption>
            <img src={cadSrc} alt={cadAlt} />
          </figure>
        </div>
      </div>
    </div>,
    document.body,
  );
}
