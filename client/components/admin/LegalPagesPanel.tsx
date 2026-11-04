import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, FilePlus2, History, Pencil, Rocket, Save, Scale } from "lucide-react";
import type { LegalSlug, LegalVersion } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminLegal, fetchLegalVersion, publishLegal, saveLegalDraft, startLegalDraft } from "@/store/slices/legalSlice";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import { Modal } from "@/components/portal/Modal";
import AgreementDocument from "@/components/affiliate/AgreementDocument";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";
import { KitSkeleton } from "@/components/partnerKit/PartnerKit";

const SLUGS: LegalSlug[] = ["terms", "privacy", "refunds"];
const fill = (body: string, fields: Record<string, string>) => body.replace(/\{\{(\w+)\}\}/g, (m, k: string) => fields[k] ?? m);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Settings → Legal pages: Terms of Service, Privacy Policy, Refund & Cancellation. Admins edit a draft
 * (Markdown, EN + ES, live preview with prices from Settings); a super admin publishes it as a new
 * version. Older versions stay in history as proof of what members accepted.
 */
export default function LegalPagesPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { admin, adminBusy, adminError } = useAppSelector((s) => s.legal);
  const [slug, setSlug] = useState<LegalSlug>("terms");
  const [lang, setLang] = useState<"en" | "es">("en");
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [draft, setDraft] = useState<{ title_en: string; title_es: string; body_en: string; body_es: string; notes: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [effective, setEffective] = useState(today());
  const [reaccept, setReaccept] = useState(true);
  const [notify, setNotify] = useState(false);
  const [viewing, setViewing] = useState<LegalVersion | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void dispatch(fetchAdminLegal());
  }, [dispatch]);
  const doc = admin?.docs.find((d) => d.slug === slug);
  const source = doc?.draft || doc?.published || null;
  useEffect(() => {
    if (!source) return setDraft(null);
    setDraft({ title_en: source.title_en, title_es: source.title_es, body_en: source.body_en || "", body_es: source.body_es || "", notes: source.notes || "" });
    setSaved(false);
  }, [source?.version, source?.status, source?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => (draft && admin ? fill(lang === "es" ? draft.body_es : draft.body_en, { ...admin.live_fields[lang], effective_date: t("legalAdmin.previewDate") }) : ""), [draft, admin, lang, t]);
  if (!admin || !doc) return <section className={className}><KitSkeleton layout="list" rows={3} /></section>;

  const isDraft = Boolean(doc.draft);
  const dirty =
    Boolean(doc.draft && draft) &&
    (draft!.title_en !== doc.draft!.title_en || draft!.title_es !== doc.draft!.title_es || draft!.body_en !== doc.draft!.body_en || draft!.body_es !== doc.draft!.body_es || draft!.notes !== (doc.draft!.notes || ""));
  const reload = () => dispatch(fetchAdminLegal());

  return (
    <section className={cn("gw-legal-admin", className)}>
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <Scale size={18} aria-hidden /> {t("legalAdmin.title")}
        </h2>
      </div>
      <p className="pf-hint">{t("legalAdmin.lead")}</p>
      <ErrorNote error={adminError} />

      <div className="gw-legal-tabs" role="tablist" aria-label={t("legalAdmin.title")}>
        {admin.docs.map((d) => (
          <button key={d.slug} type="button" role="tab" aria-selected={d.slug === slug} className={cn("gw-legal-tab", d.slug === slug && "is-active")} onClick={() => setSlug(d.slug)}>
            <strong>{t(`legal.title_${d.slug}`)}</strong>
            <span className={cn("gw-legal-chip", d.published ? "is-live" : "is-off")}>
              {d.published ? t("legalAdmin.live", { version: d.published.version }) : t("legalAdmin.notLive")}
            </span>
            {d.scheduled ? <span className="gw-legal-chip is-scheduled">{t("legalAdmin.scheduledChip", { version: d.scheduled.version, date: d.scheduled.effective_date })}</span> : null}
            {d.draft ? <span className="gw-legal-chip is-draft">{t("legalAdmin.draftChip", { version: d.draft.version })}</span> : null}
          </button>
        ))}
      </div>

      <div className="gw-legal-meta">
        {doc.published ? (
          <span>
            {t("legalAdmin.liveSince", { version: doc.published.version, date: doc.published.effective_date || "" })} ·{" "}
            {t("legalAdmin.accepted", { count: doc.published.accepted_count })} ·{" "}
            <a className="text-link" href={doc.path} target="_blank" rel="noreferrer">
              {doc.path}
            </a>
          </span>
        ) : (
          <span>{t("legalAdmin.notLiveHint")}</span>
        )}
      </div>

      <div className="gw-agreement-langs">
        {(["en", "es"] as const).map((l) => (
          <button key={l} type="button" className={cn("pf-btn pf-btn--sm", lang === l && "is-active")} aria-pressed={lang === l} onClick={() => setLang(l)}>
            {l === "en" ? "English" : "Español"}
          </button>
        ))}
        {isDraft && admin.can_edit ? (
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => setMode(mode === "edit" ? "preview" : "edit")}>
            {mode === "edit" ? <Eye size={14} aria-hidden /> : <Pencil size={14} aria-hidden />} {t(mode === "edit" ? "legalAdmin.preview" : "legalAdmin.edit")}
          </button>
        ) : null}
        {!isDraft && admin.can_edit ? (
          <button
            type="button"
            className="pf-btn pf-btn--sm"
            disabled={adminBusy}
            onClick={async () => {
              const r = await dispatch(startLegalDraft(slug));
              if (startLegalDraft.fulfilled.match(r)) {
                await reload();
                setMode("edit");
              }
            }}
          >
            <FilePlus2 size={14} aria-hidden /> {t("legalAdmin.newDraft")}
          </button>
        ) : null}
      </div>

      {draft ? (
        <div className={cn("gw-legal-editor", mode === "edit" && isDraft && "is-editing")}>
          {mode === "edit" && isDraft ? (
            <div className="gw-legal-editor__form">
              <label className="pf-field">
                <span>{t("legalAdmin.pageTitle")}</span>
                <input
                  value={lang === "es" ? draft.title_es : draft.title_en}
                  maxLength={200}
                  onChange={(e) => setDraft({ ...draft, [lang === "es" ? "title_es" : "title_en"]: e.target.value })}
                />
              </label>
              <textarea
                className="gw-agreement-editor"
                rows={26}
                spellCheck
                value={lang === "es" ? draft.body_es : draft.body_en}
                onChange={(e) => setDraft({ ...draft, [lang === "es" ? "body_es" : "body_en"]: e.target.value })}
                aria-label={t("legalAdmin.body")}
              />
              <p className="pf-hint">{t("legalAdmin.syntax")}</p>
              <p className="pf-hint gw-ca-fieldlist">{Object.keys(admin.live_fields.en).map((k) => `{{${k}}}`).join(" ")}</p>
              <label className="pf-field">
                <span>{t("legalAdmin.notes")}</span>
                <input value={draft.notes} maxLength={500} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </label>
            </div>
          ) : null}
          <div className="gw-legal-editor__preview gw-agreement-scroll">
            <AgreementDocument body={preview} />
          </div>
        </div>
      ) : null}

      {isDraft && admin.can_edit ? (
        <div className="pf-actions">
          <BusyButton
            icon={Save}
            label={saved && !dirty ? t("legalAdmin.saved") : t("legalAdmin.saveDraft")}
            busy={adminBusy}
            disabled={!dirty}
            onClick={async () => {
              if (!draft) return;
              const r = await dispatch(saveLegalDraft({ slug, body: draft }));
              if (saveLegalDraft.fulfilled.match(r)) {
                setSaved(true);
                await reload();
              }
            }}
          />
          {admin.can_publish ? (
            <BusyButton
              tone="gold"
              icon={Rocket}
              label={t("legalAdmin.publish", { version: doc.draft!.version })}
              disabled={dirty}
              onClick={() => {
                setEffective(admin.today || today());
                setReaccept(!doc.published);
                // A change to a live page: notify members by default (the Terms promise 30 days' notice).
                setNotify(Boolean(doc.published) && slug !== "privacy");
                setPublishing(true);
              }}
            />
          ) : (
            <span className="pf-hint">{t("legalAdmin.publishSuper")}</span>
          )}
        </div>
      ) : null}
      {dirty ? <p className="pf-hint">{t("legalAdmin.saveFirst")}</p> : null}

      <details className="gw-legal-history">
        <summary>
          <History size={14} aria-hidden /> {t("legalAdmin.history", { count: doc.versions.length })}
        </summary>
        <ul>
          {doc.versions.map((v) => (
            <li key={v.version}>
              <button
                type="button"
                className="gw-linkbtn"
                onClick={async () => {
                  const r = await dispatch(fetchLegalVersion({ slug, version: v.version }));
                  if (fetchLegalVersion.fulfilled.match(r)) setViewing(r.payload.version);
                }}
              >
                v{v.version}
              </button>
              <span className={cn("gw-legal-chip", v.status === "published" ? "is-live" : v.status === "draft" ? "is-draft" : v.status === "scheduled" ? "is-scheduled" : "is-off")}>{t(`legalAdmin.status_${v.status}`)}</span>
              <small>
                {v.effective_date ? t("legal.effective", { date: v.effective_date }) : fmt.date(v.updated_at)}
                {v.requires_reacceptance ? ` · ${t("legalAdmin.reacceptShort")}` : ""}
                {v.accepted_count ? ` · ${t("legalAdmin.accepted", { count: v.accepted_count })}` : ""}
                {v.notices_sent ? ` · ${t("legalAdmin.noticesSent", { count: v.notices_sent })}` : ""}
                {v.notes ? ` · ${v.notes}` : ""}
              </small>
            </li>
          ))}
        </ul>
      </details>

      <Modal open={publishing} titleKey="legalAdmin.publishTitle" onClose={() => setPublishing(false)}>
        <div className="pf-form">
          <p className="pf-muted">{t("legalAdmin.publishLead", { page: t(`legal.title_${slug}`), version: doc.draft?.version ?? "" })}</p>
          <label className="pf-field">
            <span>{t("legalAdmin.effectiveDate")}</span>
            <input type="date" value={effective} min={admin.today} onChange={(e) => setEffective(e.target.value)} />
          </label>
          <p className="pf-hint">{effective > admin.today ? t("legalAdmin.willSchedule", { date: effective }) : t("legalAdmin.willGoLive")}</p>
          {slug !== "privacy" ? (
            <label className="consent">
              <input type="checkbox" checked={reaccept} onChange={(e) => setReaccept(e.target.checked)} />
              <span>{t("legalAdmin.reaccept")}</span>
            </label>
          ) : null}
          <label className="consent">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>{t("legalAdmin.notify", { count: admin.member_count })}</span>
          </label>
          {notify && effective < addDays(admin.today, 37) && slug === "terms" ? <p className="pf-hint gw-legal-warn">{t("legalAdmin.noticeShort")}</p> : null}
          <div className="pf-actions">
            <BusyButton
              tone="gold"
              icon={Rocket}
              label={effective > admin.today ? t("legalAdmin.scheduleNow") : t("legalAdmin.publishNow")}
              busy={adminBusy}
              disabled={!effective}
              onClick={async () => {
                const r = await dispatch(publishLegal({ slug, effective_date: effective, requires_reacceptance: slug !== "privacy" && reaccept, notify_members: notify }));
                if (publishLegal.fulfilled.match(r)) {
                  setPublishing(false);
                  setMode("preview");
                  await reload();
                }
              }}
            />
          </div>
        </div>
      </Modal>
      <Modal open={Boolean(viewing)} titleKey="legalAdmin.versionTitle" onClose={() => setViewing(null)}>
        {viewing ? (
          <div className="gw-agreement-scroll">
            <p className="pf-muted">
              v{viewing.version} · {t(`legalAdmin.status_${viewing.status}`)}
              {viewing.effective_date ? ` · ${t("legal.effective", { date: viewing.effective_date })}` : ""}
            </p>
            <AgreementDocument body={fill((lang === "es" ? viewing.body_es : viewing.body_en) || "", { ...admin.live_fields[lang], effective_date: viewing.effective_date || "" })} />
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
