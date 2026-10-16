import { useEffect, useState } from "react";
import { Eye, FileSignature, Pencil, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAgreementTemplate, fetchOutdatedAgreements, publishAgreementTemplate, sendResignNotice } from "@/store/slices/affiliateOnboardingSlice";
import { BusyButton, ErrorNote, Loading, Modal } from "@/components/portal/kit";
import AgreementDocument from "@/components/affiliate/AgreementDocument";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Settings → Affiliate Agreement: edit EN/ES text and publish a new version
 * (attorney changes without a deploy). Already-signed agreements keep the
 * exact text they signed; new signers get the latest published version.
 */
export default function AgreementTemplatePanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { template, templateSaving, templateError } = useAppSelector((s) => s.affiliateOnboarding);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState<{ en: string; es: string } | null>(null);
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    void dispatch(fetchAgreementTemplate());
  }, [dispatch]);
  useEffect(() => {
    if (template) setDraft({ en: template.template.body_en, es: template.template.body_es });
  }, [template]);

  if (!template || !draft) return <section className={className}><Loading /></section>;
  const dirty = draft.en !== template.template.body_en || draft.es !== template.template.body_es;

  return (
    <section className={cn("gw-agreement-admin", className)}>
      <div className="pf-section-head">
        <h2 className="pf-h2"><FileSignature size={18} aria-hidden /> {t("affAgreement.templateTitle")}</h2>
        <span className="pf-muted">
          {t("affAgreement.templateMeta", {
            version: template.template.version,
            date: fmt.date(template.template.published_at),
            count: template.signed_count,
          })}
        </span>
      </div>
      <p className="pf-hint">{t("affAgreement.templateHint")}</p>
      <ErrorNote error={templateError} />
      <ResignNotice />
      <div className="gw-agreement-langs">
        {(["en", "es"] as const).map((l) => (
          <button key={l} type="button" className={cn("pf-btn pf-btn--sm", lang === l && "is-active")} aria-pressed={lang === l} onClick={() => setLang(l)}>
            {l === "en" ? "English" : "Español"}
          </button>
        ))}
        <button type="button" className="pf-btn pf-btn--sm" onClick={() => setMode(mode === "edit" ? "preview" : "edit")}>
          {mode === "edit" ? <Eye size={14} aria-hidden /> : <Pencil size={14} aria-hidden />}{" "}
          {t(mode === "edit" ? "affAgreement.templatePreview" : "affAgreement.templateEdit")}
        </button>
      </div>
      {mode === "edit" ? (
        <>
          <textarea
            className="gw-agreement-editor"
            rows={22}
            spellCheck
            value={draft[lang]}
            onChange={(e) => setDraft({ ...draft, [lang]: e.target.value })}
            aria-label={t("affAgreement.templateTitle")}
          />
          <p className="pf-hint">{t("affAgreement.templateSyntax")}</p>
        </>
      ) : (
        <div className="gw-agreement-scroll">
          <AgreementDocument body={draft[lang]} />
        </div>
      )}
      {dirty ? (
        <div className="pf-actions">
          <button type="button" className="pf-btn" onClick={() => setDraft({ en: template.template.body_en, es: template.template.body_es })}>
            {t("pf.cancel")}
          </button>
          <BusyButton tone="gold" label={t("affAgreement.templatePublish")} onClick={() => setConfirm(true)} />
        </div>
      ) : null}
      <Modal open={confirm} titleKey="affAgreement.templatePublish" onClose={() => setConfirm(false)}>
        <div className="pf-form">
          <p className="pf-muted">{t("affAgreement.templatePublishHelp", { version: template.template.version + 1 })}</p>
          <label className="pf-field">
            <span>{t("affAgreement.templateNotes")}</span>
            <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="pf-actions">
            <button type="button" className="pf-btn" onClick={() => setConfirm(false)}>{t("pf.cancel")}</button>
            <BusyButton
              tone="gold"
              label={t("affAgreement.templatePublish")}
              busy={templateSaving}
              onClick={async () => {
                const r = await dispatch(publishAgreementTemplate({ body_en: draft.en, body_es: draft.es, notes: notes.trim() || undefined }));
                if (publishAgreementTemplate.fulfilled.match(r)) {
                  setConfirm(false);
                  setNotes("");
                  setMode("preview");
                }
              }}
            />
          </div>
        </div>
      </Modal>
    </section>
  );
}

/** Staff: who still has an older signed version, and a one-click (confirmed) email asking them to re-sign. */
function ResignNotice() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { outdated, resignSending, resignSent } = useAppSelector((s) => s.affiliateOnboarding);
  useEffect(() => {
    void dispatch(fetchOutdatedAgreements());
  }, [dispatch, resignSent]);
  if (!outdated || !outdated.count) return null;
  return (
    <div className="gw-resign">
      <p>
        {resignSent != null
          ? t("affAgreement.resignSent", { count: resignSent })
          : t("affAgreement.resignCount", { count: outdated.count, version: outdated.current_version })}
      </p>
      {resignSent == null ? (
        <BusyButton
          tone="gold"
          icon={Send}
          label={t("affAgreement.resignCta", { count: outdated.count })}
          busy={resignSending}
          onClick={() => {
            if (window.confirm(t("affAgreement.resignConfirm", { count: outdated.count }))) void dispatch(sendResignNotice());
          }}
        />
      ) : null}
    </div>
  );
}
