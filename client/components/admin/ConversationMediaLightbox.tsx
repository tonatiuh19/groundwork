import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ConversationMediaLightbox({
  open,
  url,
  contentType,
  onClose,
}: {
  open: boolean;
  url: string | null;
  contentType?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !url) return null;

  const isVideo = String(contentType || "").startsWith("video/");
  const isAudio = String(contentType || "").startsWith("audio/");

  return createPortal(
    <div
      className="pf-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="gw-media-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={t("conversations.media")}
      >
        <button
          type="button"
          className="pf-icon-btn gw-media-lightbox__close"
          onClick={onClose}
          aria-label={t("conversations.close")}
        >
          <X className="w-5 h-5" />
        </button>
        {isVideo ? (
          <video src={url} controls className="gw-media-lightbox__media" />
        ) : isAudio ? (
          <audio src={url} controls className="gw-media-lightbox__audio" />
        ) : (
          <img src={url} alt="" className="gw-media-lightbox__media" />
        )}
      </div>
    </div>,
    document.body,
  );
}
