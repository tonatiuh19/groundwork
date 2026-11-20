import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, CalendarDays, Eye, FileDown, FilePlus2, FileSignature, ListChecks, PencilLine, Send, Users } from "lucide-react";
import type { AddendumBody, AffiliateAddendum } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  countersignAddendum,
  createAddendum,
  fetchAddendumOptions,
  fetchAddendumProjects,
  fetchAffiliateAddenda,
  previewAddendum,
  saveAddendum,
  sendAddendum,
  tagAddendumProject,
  voidAddendum,
} from "@/store/slices/addendaSlice";
import { BusyButton, ErrorNote, StatusBadge } from "@/components/portal/kit";
import { SideDrawer } from "@/components/portal/SideDrawer";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import DangerConfirmModal from "@/components/portal/DangerConfirmModal";
import AgreementDocument from "@/components/affiliate/AgreementDocument";
import ImproveWithAiButton from "@/components/ai/ImproveWithAiButton";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

const PLACEHOLDERS = ["affiliate_name", "rate_per_sqft", "events", "assigned_affiliates", "pay_terms", "effective_date"].map((k) => `{{${k}}}`).join(", ");

type Draft = { title: string; rate: string; pay_mode: "replace" | "extra"; event_ids: number[]; affiliate_ids: number[]; body_en: string; body_es: string };
const toDraft = (a: AffiliateAddendum | null): Draft => ({
  title: a?.title ?? "",
  rate: a ? (a.rate_cents_per_sqft / 100).toFixed(2) : "1.00",
  pay_mode: a?.pay_mode ?? "replace",
  event_ids: a?.events.map((e) => e.id) ?? [],
  affiliate_ids: a?.affiliates.map((x) => x.id) ?? [],
  body_en: a?.body_en ?? "",
  body_es: a?.body_es ?? "",
});

/**
 * Affiliate page → Special agreements: addenda on top of the affiliate agreement that pay a rate per sq ft
 * on projects from linked events and / or other affiliates' clients. Draft → send → affiliate signs →
 * super admin countersigns → it pays with the loan. Covered projects can be included / excluded by hand.
 */
export default function AddendaPanel({ affiliateId, affiliateName, canWrite, isSuper }: { affiliateId: number; affiliateName: string; canWrite: boolean; isSuper: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const list = useAppSelector((s) => s.addenda.byAffiliate[affiliateId]);
  const { options, busy, error, projects } = useAppSelector((s) => s.addenda);
  const [editing, setEditing] = useState<AffiliateAddendum | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft(null));
  const [bodyLang, setBodyLang] = useState<"en" | "es">("en");
  const [preview, setPreview] = useState<{ en: string; es: string; missing: string[] } | null>(null);
  const [openProjects, setOpenProjects] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<AffiliateAddendum | null>(null);
  const [counter, setCounter] = useState<AffiliateAddendum | null>(null);

  useEffect(() => {
    void dispatch(fetchAffiliateAddenda(affiliateId));
  }, [dispatch, affiliateId]);
  // Staff notice links land on #addenda.
  useEffect(() => {
    if (list && window.location.hash === "#addenda") document.getElementById("addenda")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [Boolean(list)]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEditor = (a: AffiliateAddendum | "new") => {
    if (!options) void dispatch(fetchAddendumOptions());
    setDraft(toDraft(a === "new" ? null : a));
    setPreview(null);
    setBodyLang("en");
    setEditing(a);
  };
  const eventItems = useMemo(
    () => (options?.events ?? []).map((e) => ({ id: e.id, label: lang === "es" ? e.title_es : e.title, sub: [e.starts_at ? fmt.date(e.starts_at) : null, e.city].filter(Boolean).join(" · ") })),
    [options, lang, fmt],
  );
  const affItems = useMemo(
    () => (options?.affiliates ?? []).filter((a) => a.id !== affiliateId).map((a) => ({ id: a.id, label: a.name, sub: a.company || undefined })),
    [options, affiliateId],
  );

  const body = (): AddendumBody => ({
    title: draft.title.trim() || t("addendum.defaultTitle"),
    rate_cents_per_sqft: Math.round(Number(draft.rate || 0) * 100),
    pay_mode: draft.pay_mode,
    event_ids: draft.event_ids,
    affiliate_ids: draft.affiliate_ids,
    ...(editing !== "new" ? { body_en: draft.body_en, body_es: draft.body_es } : {}),
  });
  const save = async (): Promise<AffiliateAddendum | null> => {
    const r = editing === "new" ? await dispatch(createAddendum({ affiliateId, body: body() })) : await dispatch(saveAddendum({ id: (editing as AffiliateAddendum).id, body: body() }));
    if (createAddendum.fulfilled.match(r) || saveAddendum.fulfilled.match(r)) {
      const a = r.payload.addendum;
      setEditing(a);
      setDraft(toDraft(a));
      return a;
    }
    return null;
  };
  const doPreview = async () => {
    const a = await save();
    if (!a) return;
    const r = await dispatch(previewAddendum(a.id));
    if (previewAddendum.fulfilled.match(r)) setPreview(r.payload);
  };
  const doSend = async () => {
    const a = await save();
    if (!a) return;
    const r = await dispatch(sendAddendum(a.id));
    if (sendAddendum.fulfilled.match(r)) setEditing(null);
  };
  const toggleProjects = (id: number) => {
    setOpenProjects(openProjects === id ? null : id);
    if (openProjects !== id) void dispatch(fetchAddendumProjects(id));
  };
  const tag = async (id: number, projectId: number, mode: "include" | "exclude" | "clear") => {
    const reason = mode === "clear" ? "" : window.prompt(t(mode === "exclude" ? "addendum.excludeWhy" : "addendum.includeWhy")) || "";
    if (mode !== "clear" && reason.trim().length < 3) return;
    const r = await dispatch(tagAddendumProject({ id, projectId, mode, reason }));
    if (tagAddendumProject.fulfilled.match(r)) void dispatch(fetchAddendumProjects(id));
  };
  const editable = (a: AffiliateAddendum) => a.status === "draft" || a.status === "sent";
  const rate = (cents: number) => `${fmt.money(cents)} / ${t("addendum.sqft")}`;

  return (
    <section className="pf-section gw-addenda" id="addenda">
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <FileSignature size={17} aria-hidden /> {t("addendum.title")}
        </h2>
        {canWrite ? (
          <button type="button" className="pf-btn pf-btn--sm pf-btn--gold" onClick={() => openEditor("new")}>
            <FilePlus2 size={14} aria-hidden /> {t("addendum.new")}
          </button>
        ) : null}
      </div>
      <p className="pf-hint">{t("addendum.lead", { name: affiliateName })}</p>
      <ErrorNote error={editing ? null : error} />
      {list && !list.length ? <p className="pf-muted">{t("addendum.none")}</p> : null}
      <ul className="gw-addenda__list">
        {(list ?? []).map((a) => (
          <li key={a.id} className={cn("gw-addendum-card", a.status === "void" && "is-void")}>
            <div className="gw-addendum-card__head">
              <strong>{a.title}</strong>
              <StatusBadge group="addendum.status" value={a.status} />
            </div>
            <p className="gw-addendum-card__rate">
              {rate(a.rate_cents_per_sqft)} · {t(`addendum.mode_${a.pay_mode}`)}
            </p>
            <div className="gw-addendum-card__scope">
              {a.events.length ? (
                <span>
                  <CalendarDays size={13} aria-hidden /> {a.events.map((e) => (lang === "es" ? e.title_es : e.title)).join(", ")}
                </span>
              ) : null}
              {a.affiliates.length ? (
                <span>
                  <Users size={13} aria-hidden /> {a.affiliates.map((x) => x.name).join(", ")}
                </span>
              ) : null}
            </div>
            <p className="pf-muted gw-addendum-card__when">
              {a.countersigned_at
                ? t("addendum.countersignedOn", { date: fmt.date(a.countersigned_at), name: a.countersigned_name || "" })
                : a.signed_at
                  ? t("addendum.signedOn", { date: fmt.date(a.signed_at), name: a.signed_name || "" })
                  : a.sent_at
                    ? t("addendum.sentOn", { date: fmt.date(a.sent_at) })
                    : a.voided_at
                      ? t("addendum.voidedOn", { date: fmt.date(a.voided_at), reason: a.void_reason || "" })
                      : t("addendum.draftHint")}
            </p>
            <div className="gw-addendum-card__actions">
              {canWrite && editable(a) ? (
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => openEditor(a)}>
                  <PencilLine size={13} aria-hidden /> {a.status === "sent" ? t("addendum.editResend") : t("editPanel.edit")}
                </button>
              ) : null}
              {isSuper && a.status === "signed" ? (
                <button type="button" className="pf-btn pf-btn--sm pf-btn--gold" onClick={() => setCounter(a)}>
                  <FileSignature size={13} aria-hidden /> {t("addendum.countersign")}
                </button>
              ) : null}
              <a className="pf-btn pf-btn--sm" href={`/api/admin/addenda/${a.id}/pdf`} target="_blank" rel="noreferrer">
                <FileDown size={13} aria-hidden /> PDF
              </a>
              <button type="button" className="pf-btn pf-btn--sm" aria-expanded={openProjects === a.id} onClick={() => toggleProjects(a.id)}>
                <ListChecks size={13} aria-hidden /> {t("addendum.projects")}
              </button>
              {canWrite && a.status !== "void" ? (
                <button type="button" className="pf-btn pf-btn--sm pf-btn--danger" onClick={() => setVoiding(a)}>
                  <Ban size={13} aria-hidden /> {t("addendum.void")}
                </button>
              ) : null}
            </div>
            {openProjects === a.id ? (
              <div className="gw-addendum-projects">
                {!projects[a.id] ? (
                  <p className="pf-muted">{t("pf.loading")}</p>
                ) : !projects[a.id].projects.length ? (
                  <p className="pf-muted">{t("addendum.noProjects")}</p>
                ) : (
                  <div className="gw-addendum-projects__scroll">
                    <table className="pf-table">
                      <thead>
                        <tr>
                          <th>{t("addendum.colProject")}</th>
                          <th>{t("addendum.colVia")}</th>
                          <th>{t("addendum.colSqft")}</th>
                          <th>{t("addendum.colFee")}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {projects[a.id].projects.map((p) => (
                          <tr key={p.id} className={cn(p.excluded && "is-muted")}>
                            <td>
                              <a href={`/admin/projects/${p.public_id}`}>{p.client_name}</a>
                              <small className="pf-muted"> · {t(`milestone.${p.milestone}`, { defaultValue: p.milestone })}</small>
                            </td>
                            <td>
                              {p.excluded ? t("addendum.viaExcluded") : t(`addendum.via_${p.via}`)}
                              {p.tag_reason ? <small className="pf-muted"> · {p.tag_reason}</small> : null}
                            </td>
                            <td>{p.sq_ft ?? "—"}</td>
                            <td>{p.fee_cents != null ? `${fmt.money(p.fee_cents)} · ${t(`commStatus.${p.fee_status}`, { defaultValue: p.fee_status || "" })}` : "—"}</td>
                            <td>
                              {canWrite && a.status !== "void" ? (
                                p.excluded || p.via === "staff" ? (
                                  <button type="button" className="pf-btn pf-btn--sm" disabled={busy} onClick={() => void tag(a.id, p.id, "clear")}>
                                    {t("addendum.clearTag")}
                                  </button>
                                ) : (
                                  <button type="button" className="pf-btn pf-btn--sm" disabled={busy} onClick={() => void tag(a.id, p.id, "exclude")}>
                                    {t("addendum.exclude")}
                                  </button>
                                )
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {projects[a.id]?.log.length ? (
                  <details className="gw-addendum-log">
                    <summary>{t("addendum.history")}</summary>
                    <ul>
                      {projects[a.id].log.map((l, i) => (
                        <li key={i}>
                          {l.at ? fmt.eventDateTime(l.at) : ""} · {t(`addendum.log_${l.action}`, { defaultValue: l.action })}
                          {l.detail ? ` · ${l.detail}` : ""}
                          {l.by ? ` · ${l.by}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <SideDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        busy={busy}
        icon={<FileSignature size={18} />}
        title={editing === "new" ? t("addendum.new") : t("addendum.edit")}
        subtitle={affiliateName}
        footer={
          <div className="pf-actions gw-addendum-foot">
            <button type="button" className="pf-btn" onClick={() => setEditing(null)} disabled={busy}>
              {t("pf.close")}
            </button>
            <button type="button" className="pf-btn" onClick={() => void doPreview()} disabled={busy}>
              <Eye size={14} aria-hidden /> {t("addendum.preview")}
            </button>
            <BusyButton label={t("pf.save")} busy={busy} onClick={() => void save()} />
            {editing !== "new" ? <BusyButton tone="gold" icon={Send} label={t("addendum.send")} busy={busy} onClick={() => void doSend()} /> : null}
          </div>
        }
      >
        <div className="pf-form">
          <ErrorNote error={error} />
          <label className="pf-field">
            <span>{t("addendum.fieldTitle")}</span>
            <input value={draft.title} maxLength={200} placeholder={t("addendum.defaultTitle")} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <div className="pf-form-grid">
            <label className="pf-field">
              <span>{t("addendum.fieldRate")}</span>
              <input type="number" min={0} max={100} step={0.25} inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
            </label>
            <fieldset className="pf-field gw-addendum-mode">
              <legend>{t("addendum.fieldMode")}</legend>
              {(["replace", "extra"] as const).map((m) => (
                <label key={m} className="gw-check">
                  <input type="radio" name="pay_mode" checked={draft.pay_mode === m} onChange={() => setDraft({ ...draft, pay_mode: m })} />
                  <span>
                    <strong>{t(`addendum.mode_${m}`)}</strong>
                    <small>{t(`addendum.modeHint_${m}`)}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <MultiSearchPicker
            icon={CalendarDays}
            label={t("addendum.fieldEvents")}
            items={eventItems}
            selected={draft.event_ids}
            onToggle={(id) => setDraft({ ...draft, event_ids: draft.event_ids.includes(id) ? draft.event_ids.filter((x) => x !== id) : [...draft.event_ids, id] })}
            empty={t("addendum.noEvents")}
          />
          <MultiSearchPicker
            icon={Users}
            label={t("addendum.fieldAffiliates")}
            items={affItems}
            selected={draft.affiliate_ids}
            onToggle={(id) => setDraft({ ...draft, affiliate_ids: draft.affiliate_ids.includes(id) ? draft.affiliate_ids.filter((x) => x !== id) : [...draft.affiliate_ids, id] })}
          />
          <p className="pf-hint">{t("addendum.scopeHint")}</p>
          {editing !== "new" ? (
            <div className="gw-addendum-body">
              <div className="gw-addendum-body__head">
                <span className="pf-field__label">{t("addendum.fieldText")}</span>
                <div className="gw-addendum-lang" role="tablist">
                  {(["en", "es"] as const).map((l) => (
                    <button key={l} type="button" role="tab" aria-selected={bodyLang === l} className={cn(bodyLang === l && "is-on")} onClick={() => setBodyLang(l)}>
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                rows={14}
                value={bodyLang === "en" ? draft.body_en : draft.body_es}
                onChange={(e) => setDraft({ ...draft, [bodyLang === "en" ? "body_en" : "body_es"]: e.target.value })}
              />
              <ImproveWithAiButton
                value={bodyLang === "en" ? draft.body_en : draft.body_es}
                onChange={(v) => setDraft({ ...draft, [bodyLang === "en" ? "body_en" : "body_es"]: v })}
                kind="template"
                disabled={busy}
              />
              <p className="pf-hint">{t("addendum.placeholdersHint", { list: PLACEHOLDERS })}</p>
            </div>
          ) : (
            <p className="pf-hint">{t("addendum.textAfterCreate")}</p>
          )}
          {preview ? (
            <div className="gw-addendum-preview">
              {preview.missing.length ? <p className="pf-error">{t("addendum.missing", { list: preview.missing.join(", ") })}</p> : null}
              <AgreementDocument body={bodyLang === "en" ? preview.en : preview.es} />
            </div>
          ) : null}
        </div>
      </SideDrawer>

      <DangerConfirmModal
        open={voiding !== null}
        titleKey="addendum.voidTitle"
        confirmLabel={t("addendum.void")}
        busy={busy}
        error={error}
        onCancel={() => setVoiding(null)}
        onConfirm={async (typed) => {
          if (!voiding) return;
          const r = await dispatch(voidAddendum({ id: voiding.id, reason: typed }));
          if (voidAddendum.fulfilled.match(r)) setVoiding(null);
        }}
        inputLabel={t("addendum.voidReason")}
      >
        <p>{t("addendum.voidBody")}</p>
      </DangerConfirmModal>

      <DangerConfirmModal
        open={counter !== null}
        titleKey="addendum.countersignTitle"
        confirmLabel={t("addendum.countersign")}
        busy={busy}
        error={error}
        onCancel={() => setCounter(null)}
        onConfirm={async (typed) => {
          if (!counter) return;
          const r = await dispatch(countersignAddendum({ id: counter.id, name: typed }));
          if (countersignAddendum.fulfilled.match(r)) setCounter(null);
        }}
        inputLabel={t("addendum.countersignName")}
      >
        <p>{t("addendum.countersignBody", { rate: counter ? rate(counter.rate_cents_per_sqft) : "" })}</p>
      </DangerConfirmModal>
    </section>
  );
}
