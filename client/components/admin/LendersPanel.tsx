import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Landmark, Pencil, Plus } from "lucide-react";
import type { Lender, LenderBody } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLenders, saveLender } from "@/store/slices/schedulerSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { SideDrawer } from "@/components/portal/SideDrawer";
import { cn } from "@/lib/cn";

type Draft = { id: number | null } & Required<Omit<LenderBody, "contact_name" | "email" | "phone" | "notes">> & {
  contact_name: string;
  email: string;
  phone: string;
  notes: string;
};
export const EMPTY_LENDER: Draft = { id: null, company: "", contact_name: "", email: "", phone: "", preferred_language: "en", notes: "", is_active: true };

/** Lender editor (drawer) — shared by Settings and the appointment drawer's quick add. */
export function LenderEditor({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved?: (lenders: Lender[]) => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { lendersSaving, lendersError } = useAppSelector((s) => s.scheduler);
  const [d, setD] = useState<Draft | null>(draft);
  useEffect(() => setD(draft), [draft]);
  const save = async () => {
    if (!d) return;
    const { id, ...b } = d;
    const r = await dispatch(
      saveLender({
        id,
        body: { ...b, company: b.company.trim(), contact_name: b.contact_name.trim() || null, email: b.email.trim() || null, phone: b.phone.trim() || null, notes: b.notes.trim() || null },
      }),
    );
    if (saveLender.fulfilled.match(r)) {
      onSaved?.(r.payload.lenders);
      onClose();
    }
  };
  return (
    <SideDrawer
      open={d != null}
      onClose={onClose}
      busy={lendersSaving}
      icon={<Landmark size={18} />}
      title={d?.id ? t("lenders.editTitle") : t("lenders.newTitle")}
      subtitle={t("lenders.drawerLead")}
      footer={
        <div className="pf-actions">
          <button type="button" className="pf-btn" onClick={onClose} disabled={lendersSaving}>
            {t("pf.cancel")}
          </button>
          <BusyButton tone="gold" label={t("pf.save")} busy={lendersSaving} disabled={!d || d.company.trim().length < 2} onClick={() => void save()} />
        </div>
      }
    >
      {d ? (
        <div className="pf-form">
          <ErrorNote error={lendersError} />
          <label className="pf-field">
            <span>{t("lenders.company")}</span>
            <input value={d.company} maxLength={200} onChange={(e) => setD({ ...d, company: e.target.value })} />
          </label>
          <label className="pf-field">
            <span>{t("lenders.contact")}</span>
            <input value={d.contact_name} maxLength={200} onChange={(e) => setD({ ...d, contact_name: e.target.value })} />
          </label>
          <div className="pf-form-grid">
            <label className="pf-field">
              <span>{t("form.email")}</span>
              <input type="email" value={d.email} maxLength={255} onChange={(e) => setD({ ...d, email: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("form.phone")}</span>
              <input type="tel" value={d.phone} maxLength={40} onChange={(e) => setD({ ...d, phone: e.target.value })} />
            </label>
          </div>
          <label className="pf-field">
            <span>{t("admin.profileLanguage")}</span>
            <select value={d.preferred_language} onChange={(e) => setD({ ...d, preferred_language: e.target.value as "en" | "es" })}>
              <option value="en">{t("lang.en")}</option>
              <option value="es">{t("lang.es")}</option>
            </select>
          </label>
          <label className="pf-field">
            <span>{t("pf.notes")}</span>
            <textarea rows={3} maxLength={2000} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
          </label>
          <label className="gw-switch">
            <input type="checkbox" checked={d.is_active} onChange={(e) => setD({ ...d, is_active: e.target.checked })} />
            <span className="gw-switch__track" aria-hidden />
            <span>{t("lenders.active")}</span>
          </label>
        </div>
      ) : null}
    </SideDrawer>
  );
}

/** Settings → Lenders directory (tag on appointments, link to projects). */
export default function LendersPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const lenders = useAppSelector((s) => s.scheduler.lenders);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    void dispatch(fetchLenders());
  }, [dispatch]);
  return (
    <section className={cn("gw-lenders", className)}>
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <Landmark size={17} aria-hidden /> {t("lenders.title")}
        </h2>
        <button type="button" className="pf-btn pf-btn--sm" onClick={() => setDraft({ ...EMPTY_LENDER })}>
          <Plus size={14} aria-hidden /> {t("lenders.add")}
        </button>
      </div>
      <p className="pf-hint">{t("lenders.lead")}</p>
      {!lenders.length ? <p className="pf-muted">{t("lenders.empty")}</p> : null}
      <ul className="gw-faq-admin__list">
        {lenders.map((l) => (
          <li key={l.id} className={cn(!l.is_active && "is-off")}>
            <div className="gw-faq-admin__text">
              <strong>{l.company}</strong>
              <span className="pf-muted">{[l.contact_name, l.email, l.phone].filter(Boolean).join(" · ") || "—"}</span>
              <span className="pf-muted">{t("lenders.projects", { count: l.project_count })}</span>
            </div>
            <button
              type="button"
              className="pf-btn pf-btn--sm"
              aria-label={t("lenders.editTitle")}
              onClick={() =>
                setDraft({
                  id: l.id,
                  company: l.company,
                  contact_name: l.contact_name || "",
                  email: l.email || "",
                  phone: l.phone || "",
                  preferred_language: l.preferred_language,
                  notes: l.notes || "",
                  is_active: l.is_active,
                })
              }
            >
              <Pencil size={13} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <LenderEditor draft={draft} onClose={() => setDraft(null)} />
    </section>
  );
}
