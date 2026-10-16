import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Pencil, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CONVERSATION_TEMPLATE_CATEGORIES, type ConversationTemplate, type ConversationTemplateCategory } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createConversationTemplate,
  deleteConversationTemplate,
  fetchConversationTemplates,
  updateConversationTemplate,
} from "@/store/slices/conversationsSlice";
import { BusyButton, EmptyState, ErrorNote, Loading, Modal, PageHeader } from "@/components/portal/kit";
import {
  CONVERSATION_TEMPLATE_VARS,
  applyConversationTemplateVars,
  buildConversationMergeVars,
} from "@/lib/conversationTemplateVars";
import { smsSegmentInfo } from "@/lib/smsSegments";
import { cn } from "@/lib/cn";

const TEMPLATE_ROLES = new Set(["super_admin", "admin", "agent"]);
const SAMPLE = buildConversationMergeVars({ first_name: "Maria", last_name: "Lopez", phone: "(951) 555-0101", client_status: "Prospect" });

type Draft = { id: number | null; title: string; category: ConversationTemplateCategory; body_en: string; body_es: string };
const EMPTY: Draft = { id: null, title: "", category: "general", body_en: "", body_es: "" };

/** Textarea with {{variable}} chips that insert at the caret (same tokens the composer fills). */
function VarTextarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (key: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const next = `${value.slice(0, start)}{{${key}}}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      const caret = start + key.length + 4;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };
  const seg = smsSegmentInfo(applyConversationTemplateVars(value, SAMPLE));
  return (
    <label className="pf-field gw-tpl-field">
      <span>{label}</span>
      <textarea ref={ref} rows={5} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="gw-tpl-vars">
        {CONVERSATION_TEMPLATE_VARS.map((v) => (
          <button key={v.key} type="button" className="gw-tpl-var" onClick={() => insert(v.key)}>
            {`{{${v.key}}}`}
          </button>
        ))}
        <span className="pf-hint gw-tpl-seg">
          {seg.length} · {seg.segments} SMS
        </span>
      </div>
    </label>
  );
}

/**
 * Conversations → Templates (modeled on real-state Communication Templates):
 * search + category filter, bilingual SMS bodies with {{variables}}, live
 * preview, usage counts, edit / activate / delete. Staff in super_admin /
 * admin / agent can manage; everyone else sees read-only.
 */
export default function AdminTemplates() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.portalAuth.admin.user);
  const templates = useAppSelector((s) => s.conversations.templates);
  const loading = useAppSelector((s) => s.conversations.templatesLoading);
  const canManage = TEMPLATE_ROLES.has(String(me?.role || ""));
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<ConversationTemplateCategory | "">("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewLang, setPreviewLang] = useState<"en" | "es">("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchConversationTemplates({ all: true }));
  }, [dispatch]);

  // "Save as template" from the message box: /admin/templates?new=1&body=…
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") !== "1" || !canManage) return;
    setDraft({ ...EMPTY, body_en: params.get("body") || "" });
    setParams({}, { replace: true });
  }, [params, setParams, canManage]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...templates]
      .filter((x) => !cat || (x.category || "general") === cat)
      .filter((x) => !needle || `${x.title} ${x.body_en} ${x.body_es || ""}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || (b.usage_count || 0) - (a.usage_count || 0) || a.title.localeCompare(b.title));
  }, [templates, q, cat]);

  const openEdit = (x: ConversationTemplate) =>
    setDraft({ id: x.id, title: x.title, category: (x.category || "general") as ConversationTemplateCategory, body_en: x.body_en, body_es: x.body_es || "" });

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body = { title: draft.title.trim(), category: draft.category, body_en: draft.body_en.trim(), body_es: draft.body_es.trim() || null };
      if (draft.id) await dispatch(updateConversationTemplate({ id: draft.id, ...body })).unwrap();
      else await dispatch(createConversationTemplate(body)).unwrap();
      setDraft(null);
    } catch (e) {
      setError(typeof e === "string" ? e : "errors.server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="templates.title"
        leadKey="templates.lead"
        actions={
          canManage ? (
            <button type="button" className="button button-gold" onClick={() => setDraft({ ...EMPTY })}>
              <Plus size={16} /> {t("templates.new")}
            </button>
          ) : undefined
        }
      />
      <div className="pf-filters">
        <label className="gw-tpl-search">
          <Search size={15} aria-hidden />
          <input value={q} placeholder={t("templates.search")} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="gw-tpl-cats" role="tablist" aria-label={t("templates.category")}>
          {(["", ...CONVERSATION_TEMPLATE_CATEGORIES] as const).map((c) => (
            <button key={c || "all"} type="button" role="tab" aria-selected={cat === c} className={cn("gw-tpl-cat", cat === c && "is-active")} onClick={() => setCat(c)}>
              {t(c ? `templates.cat.${c}` : "templates.all")}
            </button>
          ))}
        </div>
      </div>

      {loading && !templates.length ? <Loading /> : null}
      {!loading && !list.length ? <EmptyState messageKey="templates.empty" /> : null}
      <ul className="gw-tpl-grid">
        {list.map((x) => (
          <li key={x.id} className={cn("gw-tpl-card", !x.is_active && "is-off")}>
            <div className="gw-tpl-card__head">
              <strong>{x.title}</strong>
              <span className="pf-badge pf-badge--muted">{t(`templates.cat.${x.category || "general"}`)}</span>
            </div>
            <p className="gw-tpl-card__body">{applyConversationTemplateVars(x.body_en, SAMPLE)}</p>
            {x.body_es ? <p className="gw-tpl-card__body is-es">ES · {applyConversationTemplateVars(x.body_es, SAMPLE)}</p> : null}
            <div className="gw-tpl-card__foot">
              <span className="pf-muted">{t("templates.used", { count: x.usage_count || 0 })}</span>
              {canManage ? (
                <div className="pf-actions">
                  <button type="button" className="pf-btn pf-btn--sm" onClick={() => openEdit(x)}>
                    <Pencil size={13} aria-hidden /> {t("templates.edit")}
                  </button>
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    onClick={() => void dispatch(updateConversationTemplate({ id: x.id, is_active: !x.is_active }))}
                  >
                    {t(x.is_active ? "conversations.templateDeactivate" : "conversations.templateActivate")}
                  </button>
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    onClick={() => {
                      if (window.confirm(t("templates.deleteConfirm", { title: x.title }))) {
                        void dispatch(deleteConversationTemplate({ id: x.id }));
                      }
                    }}
                  >
                    {t("conversations.templateDelete")}
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <Modal open={draft != null} titleKey={draft?.id ? "templates.editTitle" : "templates.newTitle"} onClose={() => setDraft(null)}>
        {draft ? (
          <div className="pf-form gw-tpl-editor">
            <ErrorNote error={error} />
            <div className="pf-form-grid">
              <label className="pf-field">
                <span>{t("conversations.templateTitle")}</span>
                <input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="pf-field">
                <span>{t("templates.category")}</span>
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ConversationTemplateCategory })}>
                  {CONVERSATION_TEMPLATE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{t(`templates.cat.${c}`)}</option>
                  ))}
                </select>
              </label>
            </div>
            <VarTextarea label={t("conversations.templateBodyEn")} value={draft.body_en} onChange={(v) => setDraft({ ...draft, body_en: v })} />
            <VarTextarea label={t("conversations.templateBodyEs")} value={draft.body_es} onChange={(v) => setDraft({ ...draft, body_es: v })} />
            <div className="gw-tpl-preview">
              <div className="gw-tpl-preview__head">
                <FileText size={14} aria-hidden /> {t("templates.preview")}
                {(["en", "es"] as const).map((l) => (
                  <button key={l} type="button" className={cn("pf-btn pf-btn--sm", previewLang === l && "is-active")} onClick={() => setPreviewLang(l)}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="gw-tpl-bubble">
                {applyConversationTemplateVars(previewLang === "es" && draft.body_es.trim() ? draft.body_es : draft.body_en, SAMPLE) || "—"}
              </p>
              <p className="pf-hint">{t("templates.previewHint")}</p>
            </div>
            <div className="pf-actions">
              <button type="button" className="pf-btn" onClick={() => setDraft(null)}>{t("pf.cancel")}</button>
              <BusyButton tone="gold" className="pf-submit" label={t("pf.save")} busy={busy} disabled={!draft.title.trim() || !draft.body_en.trim()} onClick={() => void save()} />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
