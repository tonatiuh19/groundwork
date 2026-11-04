import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, Download, Eye, FileSignature, Lock, PenLine, RefreshCw, Save, Send, ShieldAlert, XCircle } from "lucide-react";
import type { ConstructionAgreementFieldGroup, ConstructionAgreementSigner } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  countersignAgreement,
  createProjectAgreement,
  fetchProjectAgreement,
  prefillAgreement,
  resendAgreement,
  saveAgreementFields,
  sendAgreement,
  voidAgreement,
} from "@/store/slices/constructionAgreementSlice";
import { ErrorNote, Loading } from "@/components/portal/kit";
import { Modal } from "@/components/portal/Modal";
import SignaturePad from "@/components/portal/SignaturePad";
import AgreementDocument from "@/components/affiliate/AgreementDocument";
import { missingAgreementFields, renderConstructionAgreementPreview } from "@/lib/constructionAgreement";
import { formatMailFull } from "@/components/mail/mailFormat";
import { cn } from "@/lib/cn";

const GROUPS: ConstructionAgreementFieldGroup[] = ["parties", "property", "contractor", "price", "schedule", "terms"];

/**
 * Project page: the ADU construction agreement. Filled from the CRM, edited here with a live
 * preview, sent for e-signature (client + contractor by link, Groundwork countersigns here),
 * then stored as a signed PDF. Locked behind a DRAFT watermark until the template is attorney-approved.
 */
export default function ConstructionAgreementPanel({ pub }: { pub: string }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const data = useAppSelector((s) => s.constructionAgreement.byProject[pub]);
  const busy = useAppSelector((s) => s.constructionAgreement.busy);
  const error = useAppSelector((s) => s.constructionAgreement.error);
  const role = useAppSelector((s) => s.portalAuth.admin.user?.role);
  const canWrite = role === "super_admin" || role === "admin" || role === "agent";
  const canCountersign = role === "super_admin" || role === "admin";
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [openGroup, setOpenGroup] = useState<ConstructionAgreementFieldGroup | null>("property");
  const [tab, setTab] = useState<"fields" | "preview">("fields");
  const [signing, setSigning] = useState(false);
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    void dispatch(fetchProjectAgreement(pub));
  }, [dispatch, pub]);
  const a = data?.agreement || null;
  useEffect(() => {
    setFields(a ? { ...a.fields } : null);
  }, [a]);

  const defs = data?.fields || [];
  const dirty = Boolean(a && fields && Object.keys(fields).some((k) => fields[k] !== a.fields[k]));
  const preview = useMemo(
    () => (a && fields && a.template_body ? renderConstructionAgreementPreview(a.template_body, fields, defs) : a?.body || ""),
    [a, fields, defs],
  );
  const missing = useMemo(() => (a && fields && a.template_body ? missingAgreementFields(a.template_body, fields, defs) : a?.missing || []), [a, fields, defs]);

  if (!data) return <section className="pf-section"><Loading /></section>;
  const pdfUrl = a ? `/api/admin/construction-agreements/${a.id}/pdf` : null;
  const save = () => (a && fields ? dispatch(saveAgreementFields({ pub, id: a.id, fields })) : undefined);

  return (
    <section className="pf-section gw-ca">
      <div className="gw-ca__head">
        <h2 className="pf-h2">
          <FileSignature size={18} aria-hidden /> {t("agreement.title")}
        </h2>
        {a ? <span className={cn("gw-ca__status", `is-${a.status}`)}>{t(`agreement.status_${a.status}`)}</span> : null}
      </div>
      <ErrorNote error={error} />

      {!a ? (
        <div className="gw-ca__empty">
          <p className="pf-muted">{t("agreement.emptyLead")}</p>
          {!data.latest_template.approved ? (
            <p className="gw-ca__warn">
              <ShieldAlert size={15} aria-hidden /> {t("agreement.templateDraftWarn", { version: data.latest_template.version })}
            </p>
          ) : null}
          {canWrite ? (
            <button type="button" className="button button-gold" disabled={busy === "create"} onClick={() => void dispatch(createProjectAgreement({ pub }))}>
              <FileSignature size={16} /> {t("agreement.create")}
            </button>
          ) : null}
        </div>
      ) : null}

      {a && !a.template_approved && a.status === "draft" ? (
        <p className="gw-ca__warn">
          <Lock size={15} aria-hidden /> {t("agreement.lockedDraft", { version: a.template_version })}
        </p>
      ) : null}

      {a && a.status === "draft" && fields ? (
        <>
          <div className="gw-ca__toolbar">
            <div className="pf-segmented" role="tablist" aria-label={t("agreement.title")}>
              {(["fields", "preview"] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={tab === v} className={cn("pf-segmented-tab", tab === v && "is-active")} onClick={() => setTab(v)}>
                  {t(`agreement.tab_${v}`)}
                  {v === "fields" && missing.length ? <span className="pf-segmented-count">{missing.length}</span> : null}
                </button>
              ))}
            </div>
            <span className="gw-ca__progress">{missing.length ? t("agreement.missingCount", { count: missing.length }) : t("agreement.allFilled")}</span>
          </div>
          <div className={cn("gw-ca__grid", tab === "preview" && "show-preview")}>
            <div className="gw-ca__fields">
              {GROUPS.map((g) => {
                const groupDefs = defs.filter((d) => d.group === g);
                const groupMissing = groupDefs.filter((d) => missing.includes(d.key)).length;
                return (
                  <div key={g} className={cn("gw-ca__group", openGroup === g && "is-open")}>
                    <button type="button" className="gw-ca__group-head" aria-expanded={openGroup === g} onClick={() => setOpenGroup(openGroup === g ? null : g)}>
                      <span>{t(`agreement.group_${g}`)}</span>
                      {groupMissing ? <span className="gw-ca__badge">{groupMissing}</span> : <CheckCircle2 size={15} className="gw-ca__ok" aria-hidden />}
                    </button>
                    {openGroup === g ? (
                      <div className="gw-ca__group-body">
                        {groupDefs.map((d) => (
                          <label key={d.key} className={cn("pf-field", d.multiline && "gw-ca__wide", missing.includes(d.key) && "is-missing")}>
                            <span>
                              {t(`agreement.field_${d.key}`)}
                              {d.required ? " *" : ""}
                            </span>
                            {d.multiline ? (
                              <textarea rows={3} value={fields[d.key] || ""} readOnly={!canWrite} onChange={(e) => setFields({ ...fields, [d.key]: e.target.value })} />
                            ) : (
                              <input value={fields[d.key] || ""} readOnly={!canWrite} onChange={(e) => setFields({ ...fields, [d.key]: e.target.value })} />
                            )}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="gw-ca__preview">
              <AgreementDocument body={preview} />
            </div>
          </div>
          {canWrite ? (
            <div className="pf-actions gw-ca__actions">
              <button type="button" className="pf-btn" disabled={!dirty || busy === "save"} onClick={() => void save()}>
                <Save size={14} /> {t("agreement.save")}
              </button>
              <button type="button" className="pf-btn" disabled={busy === "prefill" || dirty} onClick={() => void dispatch(prefillAgreement({ pub, id: a.id }))} title={t("agreement.refillHint")}>
                <RefreshCw size={14} /> {t("agreement.refill")}
              </button>
              <a className="pf-btn" href={pdfUrl!} target="_blank" rel="noreferrer">
                <Eye size={14} /> {t("agreement.previewPdf")}
              </a>
              {a.template_version !== data.latest_template.version ? (
                <button type="button" className="pf-btn" onClick={() => fields && void dispatch(saveAgreementFields({ pub, id: a.id, fields, use_latest_template: true }))}>
                  {t("agreement.useLatest", { version: data.latest_template.version })}
                </button>
              ) : null}
              <button
                type="button"
                className="button button-gold"
                disabled={!a.template_approved || missing.length > 0 || dirty || busy === "send"}
                onClick={() => window.confirm(t("agreement.confirmSend")) && void dispatch(sendAgreement({ pub, id: a.id }))}
              >
                <Send size={15} /> {t("agreement.send")}
              </button>
            </div>
          ) : null}
          {dirty ? <p className="pf-hint">{t("agreement.saveFirst")}</p> : null}
        </>
      ) : null}

      {a && a.status !== "draft" ? (
        <>
          <ul className="gw-ca__signers">
            {a.signers.map((s) => (
              <SignerRow
                key={s.party}
                s={s}
                lang={i18n.language}
                canResend={canWrite && a.status === "sent" && s.party !== "groundwork" && s.status === "pending"}
                onResend={() => void dispatch(resendAgreement({ pub, id: a.id, party: s.party as "client" | "contractor" }))}
                canSign={canCountersign && a.status === "sent" && s.party === "groundwork" && s.status === "pending" && a.signers.every((x) => x.party === "groundwork" || x.status === "signed")}
                onSign={() => setSigning(true)}
              />
            ))}
          </ul>
          <div className="pf-actions gw-ca__actions">
            <a className={cn("pf-btn", a.status === "signed" && "pf-btn--gold")} href={pdfUrl!} target="_blank" rel="noreferrer">
              <Download size={14} /> {a.status === "signed" ? t("agreement.downloadSigned") : t("agreement.viewPdf")}
            </a>
            {canWrite && a.status !== "void" && (a.status !== "signed" || role === "super_admin") ? (
              <button type="button" className="pf-btn pf-btn--danger" onClick={() => setVoiding(true)}>
                <XCircle size={14} /> {t("agreement.void")}
              </button>
            ) : null}
          </div>
          <details className="gw-ca__text">
            <summary>{t("agreement.showText")}</summary>
            <AgreementDocument body={a.body} />
          </details>
        </>
      ) : null}

      {a?.status === "void" || (data.history.length && canWrite) ? (
        <div className="gw-ca__history">
          {a?.status === "void" && canWrite ? (
            <button type="button" className="button button-gold" onClick={() => void dispatch(createProjectAgreement({ pub }))}>
              <FileSignature size={16} /> {t("agreement.createNew")}
            </button>
          ) : null}
          {data.history.length ? (
            <p className="pf-hint">
              {t("agreement.history")}:{" "}
              {data.history.map((h) => `#${h.id} v${h.template_version} ${t(`agreement.status_${h.status}`)}${h.void_reason ? ` (${h.void_reason})` : ""}`).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {a ? <CountersignModal open={signing} onClose={() => setSigning(false)} onSign={async (body) => {
        const r = await dispatch(countersignAgreement({ pub, id: a.id, ...body }));
        if (countersignAgreement.fulfilled.match(r)) setSigning(false);
      }} busy={busy === "countersign"} /> : null}
      {a ? <VoidModal open={voiding} onClose={() => setVoiding(false)} onVoid={async (reason) => {
        const r = await dispatch(voidAgreement({ pub, id: a.id, reason }));
        if (voidAgreement.fulfilled.match(r)) setVoiding(false);
      }} /> : null}
    </section>
  );
}

function SignerRow({ s, lang, canResend, onResend, canSign, onSign }: { s: ConstructionAgreementSigner; lang: string; canResend: boolean; onResend: () => void; canSign: boolean; onSign: () => void }) {
  const { t } = useTranslation();
  return (
    <li className={cn("gw-ca__signer", `is-${s.status}`)}>
      <span className="gw-ca__signer-icon" aria-hidden>
        {s.status === "signed" ? <CheckCircle2 size={18} /> : <Clock size={18} />}
      </span>
      <span className="gw-ca__signer-main">
        <strong>{t(`agreement.party_${s.party}`)}</strong>
        <small>
          {s.signed_name || s.name}
          {s.email ? ` · ${s.email}` : ""}
        </small>
        <small>
          {s.status === "signed"
            ? t("agreement.signedAt", { when: formatMailFull(s.signed_at, lang) })
            : s.party === "groundwork"
              ? t("agreement.waitingCountersign")
              : s.viewed_at
                ? t("agreement.viewedAt", { when: formatMailFull(s.viewed_at, lang) })
                : s.last_sent_at
                  ? t("agreement.sentAt", { when: formatMailFull(s.last_sent_at, lang) })
                  : ""}
        </small>
      </span>
      {canResend ? (
        <button type="button" className="pf-btn" onClick={onResend}>
          <Send size={13} /> {t("agreement.resend")}
        </button>
      ) : null}
      {canSign ? (
        <button type="button" className="button button-gold" onClick={onSign}>
          <PenLine size={14} /> {t("agreement.countersign")}
        </button>
      ) : null}
    </li>
  );
}

function CountersignModal({ open, onClose, onSign, busy }: { open: boolean; onClose: () => void; onSign: (b: { signed_name: string; title: string; signature_image: string }) => void; busy: boolean }) {
  const { t } = useTranslation();
  const me = useAppSelector((s) => s.portalAuth.admin.user);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  useEffect(() => {
    if (open) setName(me ? `${me.first_name || ""} ${me.last_name || ""}`.trim() : "");
  }, [open, me]);
  return (
    <Modal open={open} titleKey="agreement.countersignTitle" onClose={onClose}>
      <div className="pf-form">
        <p className="pf-muted">{t("agreement.countersignLead")}</p>
        <label className="pf-field">
          <span>{t("agreement.signerName")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="pf-field">
          <span>{t("agreement.signerTitle")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("agreement.signerTitlePh")} />
        </label>
        <SignaturePad onChange={setSig} />
        <div className="pf-actions">
          <button type="button" className="button button-gold" disabled={busy || !sig || name.trim().length < 3 || title.trim().length < 2} onClick={() => sig && onSign({ signed_name: name.trim(), title: title.trim(), signature_image: sig })}>
            <PenLine size={15} /> {t("agreement.countersign")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function VoidModal({ open, onClose, onVoid }: { open: boolean; onClose: () => void; onVoid: (reason: string) => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} titleKey="agreement.voidTitle" onClose={onClose}>
      <div className="pf-form">
        <p className="pf-muted">{t("agreement.voidLead")}</p>
        <label className="pf-field">
          <span>{t("agreement.voidReason")}</span>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="pf-actions">
          <button type="button" className="pf-btn pf-btn--danger" disabled={reason.trim().length < 3} onClick={() => onVoid(reason.trim())}>
            <XCircle size={14} /> {t("agreement.void")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
