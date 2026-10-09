import { useTranslation } from "react-i18next";
import { Modal } from "@/components/portal/Modal";

export type PendingStatusChange = {
  id: number;
  name: string;
  from: string;
  to: string;
};

/**
 * Confirm when demoting an active account (inactive / suspended).
 * Used on Affiliates, Contractors, Clients, Staff lists.
 */
export function ConfirmStatusChangeModal({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: PendingStatusChange | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={Boolean(pending)}
      titleKey="admin.demoteStatusTitle"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      {pending ? (
        <div className="pf-form">
          <p>
            {t("admin.demoteStatusHelp", {
              name: pending.name,
              status: t(`accountStatus.${pending.to}`, {
                defaultValue: pending.to,
              }),
            })}
          </p>
          <div className="pf-table-actions" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="pf-btn pf-btn--nowrap"
              disabled={busy}
              onClick={onCancel}
            >
              {t("pf.cancel")}
            </button>
            <button
              type="button"
              className="pf-btn pf-btn--gold pf-btn--nowrap"
              disabled={busy}
              onClick={onConfirm}
            >
              {t("admin.demoteStatusConfirm")}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
