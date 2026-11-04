import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Copy, Eye, FileText, Pencil, ShieldAlert } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { approveAgreementTemplate, createAgreementTemplate, fetchAgreementTemplates, saveAgreementTemplate } from "@/store/slices/constructionAgreementSlice";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import { Modal } from "@/components/portal/Modal";
import AgreementDocument from "@/components/affiliate/AgreementDocument";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";
import { KitSkeleton } from "@/components/partnerKit/PartnerKit";

/**
 * Settings → ADU construction agreement: versioned template. Drafts can be edited and always print
 * with a DRAFT watermark; only a super admin can mark a version attorney-approved (typed APPROVED),
 * after which it is locked and agreements on it can be sent for signature.
 */
export default function ConstructionTemplatePanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { templates, templateBusy, templateError } = useAppSelector((s) => s.constructionAgreement);
  const role = useAppSelector((s) => s.portalAuth.admin.user?.role);
  const isSuper = role === "super_admin";
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [approving, setApproving] = useState(false);
  const [phrase, setPhrase] = useState("");

  useEffect(() => {
    void dispatch(fetchAgreementTemplates());
  }, [dispatch]);
  const versions = templates?.versions || [];
  const current = versions.find((v) => v.version === selected) || versions[0];
  useEffect(() => {
    if (current) {
      setDraft(current.body_en);
      setNotes(current.notes || "");
      if (current.approved) setMode("preview");
    }
  }, [current]);

  if (!templates || !current) return <section className={className}><KitSkeleton layout="list" rows={3} /></section>;
  const dirty = draft !== current.body_en || notes !== (current.notes || "");
  const fieldKeys = templates.fields.map((f) => f.key);

  return (
    <section className={cn("gw-agreement-admin", className)}>
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <FileText size={18} aria-hidden /> {t("agreementTpl.title")}
        </h2>
      </div>
      <p className="pf-hint">{t("agreementTpl.lead")}</p>
      <ErrorNote error={templateError} />
      <div className="gw-ca-versions" role="tablist" aria-label={t("agreementTpl.versions")}>
        {versions.map((v) => (
          <button key={v.version} type="button" role="tab" aria-selected={v.version === current.version} className={cn("gw-ca-version", v.version === current.version && "is-active")} onClick={() => setSelected(v.version)}>
            <strong>v{v.version}</strong>
            <span className={cn("gw-ca-version__tag", v.approved ? "is-approved" : "is-draft")}>{v.approved ? t("agreementTpl.approved") : t("agreementTpl.draft")}</span>
            <small>{t("agreementTpl.used", { count: v.agreements || 0 })}</small>
          </button>
        ))}
      </div>
      <div className={cn("gw-ca-tpl-state", current.approved ? "is-approved" : "is-draft")}>
        {current.approved ? <BadgeCheck size={16} aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
        <span>{current.approved ? t("agreementTpl.approvedOn", { date: fmt.date(current.approved_at) }) : t("agreementTpl.draftNote")}</span>
      </div>
      {current.notes ? <p className="pf-muted">{current.notes}</p> : null}
      <div className="gw-agreement-langs">
        {!current.approved ? (
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => setMode(mode === "edit" ? "preview" : "edit")}>
            {mode === "edit" ? <Eye size={14} aria-hidden /> : <Pencil size={14} aria-hidden />} {t(mode === "edit" ? "agreementTpl.preview" : "agreementTpl.edit")}
          </button>
        ) : null}
        <a className="pf-btn pf-btn--sm" href={`/api/admin/construction-agreement/template/${current.version}/pdf`} target="_blank" rel="noreferrer">
          <Eye size={14} aria-hidden /> {t("agreementTpl.pdf")}
        </a>
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          disabled={templateBusy}
          onClick={async () => {
            const r = await dispatch(createAgreementTemplate({ body_en: current.body_en, notes: t("agreementTpl.copyNote", { version: current.version }) }));
            if (createAgreementTemplate.fulfilled.match(r)) {
              setSelected(r.payload.template.version);
              setMode("edit");
            }
          }}
        >
          <Copy size={14} aria-hidden /> {t("agreementTpl.newVersion")}
        </button>
        {isSuper && !current.approved ? (
          <button type="button" className="pf-btn pf-btn--sm pf-btn--gold" disabled={dirty} onClick={() => setApproving(true)}>
            <BadgeCheck size={14} aria-hidden /> {t("agreementTpl.approve")}
          </button>
        ) : null}
      </div>
      {mode === "edit" && !current.approved ? (
        <>
          <label className="pf-field">
            <span>{t("agreementTpl.notes")}</span>
            <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <textarea className="gw-agreement-editor" rows={24} spellCheck value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t("agreementTpl.title")} />
          <p className="pf-hint">{t("agreementTpl.syntax")}</p>
          <p className="pf-hint gw-ca-fieldlist">{fieldKeys.map((k) => `{{${k}}}`).join(" ")}</p>
          {dirty ? (
            <div className="pf-actions">
              <button type="button" className="pf-btn" onClick={() => setDraft(current.body_en)}>
                {t("pf.cancel")}
              </button>
              <BusyButton tone="gold" label={t("agreementTpl.save")} busy={templateBusy} onClick={() => void dispatch(saveAgreementTemplate({ version: current.version, body_en: draft, notes }))} />
            </div>
          ) : null}
        </>
      ) : (
        <div className="gw-agreement-scroll">
          <AgreementDocument body={draft} />
        </div>
      )}
      <Modal open={approving} titleKey="agreementTpl.approveTitle" onClose={() => setApproving(false)}>
        <div className="pf-form">
          <p className="pf-muted">{t("agreementTpl.approveLead", { version: current.version })}</p>
          <label className="pf-field">
            <span>{t("agreementTpl.approvePhrase")}</span>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
          </label>
          <div className="pf-actions">
            <BusyButton
              tone="gold"
              label={t("agreementTpl.approve")}
              busy={templateBusy}
              disabled={phrase !== "APPROVED"}
              onClick={async () => {
                const r = await dispatch(approveAgreementTemplate({ version: current.version, confirm_phrase: phrase }));
                if (approveAgreementTemplate.fulfilled.match(r)) {
                  setApproving(false);
                  setPhrase("");
                }
              }}
            />
          </div>
        </div>
      </Modal>
    </section>
  );
}
