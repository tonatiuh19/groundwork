import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function Modal({
  open,
  titleKey,
  onClose,
  children,
  initialFocusRef,
}: {
  open: boolean;
  titleKey: string;
  onClose: () => void;
  children: ReactNode;
  /** When set, focus this element on open instead of the close button. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRefStable = useRef(initialFocusRef);
  initialFocusRefStable.current = initialFocusRef;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);

    // Focus once on open — do not re-run when parent re-renders (new onClose).
    window.requestAnimationFrame(() => {
      const preferred = initialFocusRefStable.current?.current;
      if (preferred) {
        preferred.focus();
        return;
      }
      const closeBtn =
        panelRef.current?.querySelector<HTMLElement>(".pf-icon-btn");
      closeBtn?.focus();
    });

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="pf-modal-backdrop"
      role="presentation"
      data-testid="pf-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="pf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="pf-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pf-modal-head">
          <h2 id={titleId}>{t(titleKey)}</h2>
          <button
            type="button"
            className="pf-icon-btn"
            onClick={onClose}
            aria-label={t("pf.close")}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
