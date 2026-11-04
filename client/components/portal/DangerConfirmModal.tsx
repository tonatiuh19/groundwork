import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/portal/Modal";
import { BusyButton, ErrorNote } from "@/components/portal/kit";

/**
 * Warning before something that can't be undone: says what will be lost and, when `confirmText` is set,
 * makes the person type it (a name) before the button unlocks.
 */
export default function DangerConfirmModal({
  open,
  titleKey,
  children,
  confirmText,
  confirmLabel,
  busy,
  ready = true,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  titleKey: string;
  children: ReactNode;
  confirmText?: string;
  confirmLabel: string;
  busy?: boolean;
  /** Extra condition (e.g. a merge target picked). */
  ready?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const ok = !confirmText || typed.trim().toLowerCase() === confirmText.trim().toLowerCase();
  return (
    <Modal open={open} titleKey={titleKey} onClose={() => !busy && onCancel()}>
      <div className="pf-form gw-danger">
        <div className="gw-danger__body">
          <AlertTriangle size={20} aria-hidden />
          <div>{children}</div>
        </div>
        {confirmText ? (
          <label className="pf-field">
            <span>{t("danger.typeToConfirm", { text: confirmText })}</span>
            <input value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          </label>
        ) : null}
        <ErrorNote error={error} />
        <div className="pf-actions">
          <button type="button" className="pf-btn" disabled={busy} onClick={onCancel}>
            {t("danger.cancel")}
          </button>
          <BusyButton className="pf-btn--danger" label={confirmLabel} busy={busy} disabled={!ok || !ready} onClick={() => onConfirm(typed)} />
        </div>
      </div>
    </Modal>
  );
}
