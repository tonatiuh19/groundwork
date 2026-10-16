import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Slide-over panel from the right (full width on phones). Escape / backdrop
 * close it, body scroll is locked while open, focus moves inside and returns
 * to the opener on close. Sits under `.pf-modal-backdrop` so confirm dialogs
 * opened from inside still stack on top.
 */
export function SideDrawer({
  open,
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  busy = false,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** While saving, Escape / backdrop don't close the panel. */
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // Let a confirm dialog on top handle its own Escape.
      if (e.key !== "Escape" || busyRef.current || document.querySelector(".pf-modal-backdrop")) return;
      // Stacked drawers: only the topmost one closes.
      const stack = document.querySelectorAll(".gw-drawer-backdrop");
      if (stack[stack.length - 1] !== panelRef.current?.parentElement) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.gw-drawer__close)");
      (first ?? panelRef.current)?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="gw-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={panelRef} className="gw-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="gw-drawer__head">
          {icon ? <span className="gw-drawer__icon" aria-hidden>{icon}</span> : null}
          <div className="gw-drawer__titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="gw-drawer__close" onClick={onClose} disabled={busy} aria-label={t("pf.close")}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="gw-drawer__body">{children}</div>
        {footer ? <footer className="gw-drawer__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Read-only label/value grid for detail pages (pairs with an "Edit" drawer). */
export function DetailList({ items }: { items: Array<{ label: ReactNode; value: ReactNode; wide?: boolean }> }) {
  return (
    <dl className="gw-detail-list">
      {items.map((it, i) => (
        <div key={i} className={it.wide ? "is-wide" : undefined}>
          <dt>{it.label}</dt>
          <dd>{it.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
