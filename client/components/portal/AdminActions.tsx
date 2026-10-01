import { useState } from "react";
import { Formik, Form } from "formik";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdminCommission, ProjectDraw } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  updateCommission,
  updateDraw,
} from "@/store/slices/adminPortalSlice";
import {
  BusyButton,
  ErrorNote,
  Modal,
  SubmitButton,
  TextField,
  useBusyAction,
} from "@/components/portal/kit";
import { centsToDollars, dollarsToCents, toDateInputValue } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

/** Status transition buttons for a draw request (projects.read — all project staff for now). */
export function DrawActions({ draw, onDone }: { draw: ProjectDraw; onDone: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const can = useAdminCan("projects.read");
  const [note, setNote] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const busy = useBusyAction(900);
  if (!can) return null;

  const act = (status: string, flashKey: string) => {
    void busy.run(
      async () => {
        setAction(status);
        const trimmed = note.trim();
        const result = await dispatch(
          updateDraw({
            id: draw.id,
            patch: trimmed ? { status, note: trimmed } : { status },
          }),
        );
        const ok = updateDraw.fulfilled.match(result);
        if (ok) setNote("");
        return ok;
      },
      {
        flash: true,
        onFlashEnd: () => {
          setAction(null);
          onDone();
        },
      },
    );
  };

  const showActions = draw.status === "submitted" || draw.status === "approved";
  if (!showActions) return null;

  const locked = busy.busy || busy.done;
  return (
    <div className="pf-actions-block">
      <label className="pf-action-note">
        <span className="pf-muted">{t("admin.actionNoteHint")}</span>
        <textarea
          className="pf-action-note-input"
          rows={2}
          value={note}
          disabled={locked}
          onChange={(e) => setNote(e.target.value)}
          aria-label={t("pf.notes")}
        />
      </label>
      <div className="pf-actions">
        {draw.status === "submitted" ? (
          <>
            <BusyButton
              tone="gold"
              label={t("admin.approve")}
              busyLabel={t("pf.busy.approving")}
              doneLabel={t("pf.done.approved")}
              busy={busy.busy && action === "approved"}
              done={busy.done && action === "approved"}
              disabled={locked && action !== "approved"}
              onClick={() => act("approved", "approved")}
            />
            <BusyButton
              label={t("admin.reject")}
              busyLabel={t("pf.busy.rejecting")}
              doneLabel={t("pf.done.rejected")}
              busy={busy.busy && action === "rejected"}
              done={busy.done && action === "rejected"}
              disabled={locked && action !== "rejected"}
              onClick={() => act("rejected", "rejected")}
            />
          </>
        ) : null}
        {draw.status === "approved" ? (
          <>
            <BusyButton
              tone="gold"
              label={t("admin.markPaid")}
              busyLabel={t("pf.busy.markingPaid")}
              doneLabel={t("pf.done.paid")}
              busy={busy.busy && action === "paid"}
              done={busy.done && action === "paid"}
              disabled={locked && action !== "paid"}
              onClick={() => act("paid", "paid")}
            />
            <BusyButton
              label={t("admin.reject")}
              busyLabel={t("pf.busy.rejecting")}
              doneLabel={t("pf.done.rejected")}
              busy={busy.busy && action === "rejected"}
              done={busy.done && action === "rejected"}
              disabled={locked && action !== "rejected"}
              onClick={() => act("rejected", "rejected")}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Status transition buttons for an affiliate commission (finance.write). */
export function CommissionActions({
  commission,
  onDone,
}: {
  commission: AdminCommission;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { saveError } = useAppSelector((s) => s.adminPortal);
  const can = useAdminCan("finance.write");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const busy = useBusyAction(900);
  const saving = useAppSelector((s) => s.adminPortal.saving);
  if (!can) return null;

  const act = (status: string) => {
    void busy.run(
      async () => {
        setAction(status);
        const trimmed = note.trim();
        const result = await dispatch(
          updateCommission({
            id: commission.id,
            patch: trimmed ? { status, notes: trimmed } : { status },
          }),
        );
        const ok = updateCommission.fulfilled.match(result);
        if (ok) setNote("");
        return ok;
      },
      {
        flash: true,
        onFlashEnd: () => {
          setAction(null);
          onDone();
        },
      },
    );
  };

  const s = commission.status;
  const showActions = s === "pending" || s === "approved" || s === "void";
  if (!showActions) return null;
  const locked = busy.busy || busy.done;

  return (
    <div className="pf-actions-block">
      <label className="pf-action-note">
        <span className="pf-muted">{t("admin.actionNoteHint")}</span>
        <textarea
          className="pf-action-note-input"
          rows={2}
          value={note}
          disabled={locked}
          onChange={(e) => setNote(e.target.value)}
          aria-label={t("pf.notes")}
        />
      </label>
      <div className="pf-actions">
        {s === "pending" ? (
          <BusyButton
            tone="gold"
            label={t("admin.approve")}
            busyLabel={t("pf.busy.approving")}
            doneLabel={t("pf.done.approved")}
            busy={busy.busy && action === "approved"}
            done={busy.done && action === "approved"}
            disabled={locked && action !== "approved"}
            onClick={() => act("approved")}
          />
        ) : null}
        {s === "approved" ? (
          <BusyButton
            tone="gold"
            label={t("admin.markPaid")}
            busyLabel={t("pf.busy.markingPaid")}
            doneLabel={t("pf.done.paid")}
            busy={busy.busy && action === "paid"}
            done={busy.done && action === "paid"}
            disabled={locked && action !== "paid"}
            onClick={() => act("paid")}
          />
        ) : null}
        {s === "void" ? (
          <BusyButton
            label={t("admin.restore")}
            busyLabel={t("pf.busy.restoring")}
            doneLabel={t("pf.done.restored")}
            busy={busy.busy && action === "pending"}
            done={busy.done && action === "pending"}
            disabled={locked && action !== "pending"}
            onClick={() => act("pending")}
          />
        ) : null}
        {s === "pending" || s === "approved" ? (
          <BusyButton
            label={t("admin.void")}
            busyLabel={t("pf.busy.voiding")}
            doneLabel={t("pf.done.voided")}
            busy={busy.busy && action === "void"}
            done={busy.done && action === "void"}
            disabled={locked && action !== "void"}
            onClick={() => act("void")}
          />
        ) : null}
        <button
          type="button"
          className="pf-btn"
          disabled={locked}
          onClick={() => {
            dispatch(clearAdminSaveError());
            setEditing(true);
          }}
        >
          <Pencil size={14} /> {t("pf.edit")}
        </button>
      </div>

      <Modal open={editing} titleKey="admin.editCommissionTitle" onClose={() => setEditing(false)}>
        <Formik
          initialValues={{
            amount: centsToDollars(commission.amount_cents),
            expected_pay_at: toDateInputValue(commission.expected_pay_at),
            notes: commission.notes || "",
          }}
          onSubmit={async (v) => {
            const r = await dispatch(
              updateCommission({
                id: commission.id,
                patch: {
                  amount_cents: dollarsToCents(v.amount) ?? 0,
                  expected_pay_at: v.expected_pay_at || null,
                  notes: v.notes.trim() || null,
                },
              }),
            );
            if (updateCommission.fulfilled.match(r)) {
              setEditing(false);
              onDone();
            }
          }}
        >
          <Form className="pf-form">
            <ErrorNote error={saveError} />
            <div className="pf-form-grid">
              <TextField name="amount" labelKey="pf.amount" placeholder="0.00" />
              <TextField name="expected_pay_at" labelKey="aff.expectedPay" type="date" />
            </div>
            <TextField name="notes" labelKey="admin.internalNotes" as="textarea" rows={3} />
            <SubmitButton busy={saving} labelKey="pf.save" />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
