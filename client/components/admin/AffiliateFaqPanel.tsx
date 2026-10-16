import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle, Pencil, Plus, Trash2 } from "lucide-react";
import type { AffiliateFaq, AffiliateFaqBody } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { deleteAdminFaq, fetchAdminFaqs, saveAdminFaq } from "@/store/slices/affiliateHelpSlice";
import { BusyButton, ErrorNote, Modal } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { cn } from "@/lib/cn";

type Draft = { id: number | null } & Required<Omit<AffiliateFaqBody, "question_es" | "answer_es">> & { question_es: string; answer_es: string };
const EMPTY: Draft = { id: null, question_en: "", answer_en: "", question_es: "", answer_es: "", sort_order: 100, is_active: true };

/**
 * Settings → Affiliate FAQ (EN/ES): shown in the affiliate portal + welcome
 * page, and the assistant answers from it (plus the agreement).
 */
export default function AffiliateFaqPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const canEdit = useAdminCan("approvals");
  const { adminFaqs, adminSaving, adminError } = useAppSelector((s) => s.affiliateHelp);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    void dispatch(fetchAdminFaqs());
  }, [dispatch]);

  const edit = (f: AffiliateFaq) =>
    setDraft({
      id: f.id,
      question_en: f.question_en,
      answer_en: f.answer_en,
      question_es: f.question_es || "",
      answer_es: f.answer_es || "",
      sort_order: f.sort_order,
      is_active: f.is_active,
    });

  const save = async () => {
    if (!draft) return;
    const { id, ...body } = draft;
    const r = await dispatch(
      saveAdminFaq({ id, body: { ...body, question_es: body.question_es.trim() || null, answer_es: body.answer_es.trim() || null } }),
    );
    if (saveAdminFaq.fulfilled.match(r)) setDraft(null);
  };

  return (
    <section className={cn("gw-faq-admin", className)}>
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <HelpCircle size={17} aria-hidden /> {t("affFaqAdmin.title")}
        </h2>
        {canEdit ? (
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => setDraft({ ...EMPTY })}>
            <Plus size={14} aria-hidden /> {t("affFaqAdmin.add")}
          </button>
        ) : null}
      </div>
      <p className="pf-hint">{t("affFaqAdmin.lead")}</p>
      <ErrorNote error={draft ? null : adminError} />
      <ul className="gw-faq-admin__list">
        {adminFaqs.map((f) => (
          <li key={f.id} className={cn(!f.is_active && "is-off")}>
            <div className="gw-faq-admin__text">
              <strong>{f.question_en}</strong>
              {f.question_es ? <span className="pf-muted">ES · {f.question_es}</span> : <span className="pf-badge pf-badge--warn">{t("affFaqAdmin.noSpanish")}</span>}
            </div>
            {canEdit ? (
              <div className="pf-actions">
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => edit(f)} aria-label={t("affFaqAdmin.edit")}>
                  <Pencil size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  className="pf-btn pf-btn--sm pf-btn--danger"
                  aria-label={t("affFaqAdmin.delete")}
                  onClick={() => {
                    if (window.confirm(t("affFaqAdmin.deleteConfirm"))) void dispatch(deleteAdminFaq(f.id));
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <Modal open={draft != null} titleKey={draft?.id ? "affFaqAdmin.editTitle" : "affFaqAdmin.addTitle"} onClose={() => setDraft(null)}>
        {draft ? (
          <div className="pf-form">
            <ErrorNote error={adminError} />
            <label className="pf-field">
              <span>{t("affFaqAdmin.questionEn")}</span>
              <input value={draft.question_en} maxLength={300} onChange={(e) => setDraft({ ...draft, question_en: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("affFaqAdmin.answerEn")}</span>
              <textarea rows={4} maxLength={4000} value={draft.answer_en} onChange={(e) => setDraft({ ...draft, answer_en: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("affFaqAdmin.questionEs")}</span>
              <input value={draft.question_es} maxLength={300} onChange={(e) => setDraft({ ...draft, question_es: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("affFaqAdmin.answerEs")}</span>
              <textarea rows={4} maxLength={4000} value={draft.answer_es} onChange={(e) => setDraft({ ...draft, answer_es: e.target.value })} />
            </label>
            <div className="pf-form-grid">
              <label className="pf-field">
                <span>{t("affFaqAdmin.order")}</span>
                <input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })} />
              </label>
              <label className="gw-check">
                <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                <span>{t("affFaqAdmin.active")}</span>
              </label>
            </div>
            <div className="pf-actions">
              <button type="button" className="pf-btn" onClick={() => setDraft(null)}>
                {t("pf.cancel")}
              </button>
              <BusyButton
                tone="gold"
                label={t("pf.save")}
                busy={adminSaving}
                disabled={draft.question_en.trim().length < 3 || draft.answer_en.trim().length < 3}
                onClick={() => void save()}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
