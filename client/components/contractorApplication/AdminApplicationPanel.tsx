import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  Eye,
  FileText,
  MessageSquareWarning,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CONTRACTOR_DOC_SPECS,
  type ContractorApplicationDocType,
  type ContractorApplicationDocument,
} from "@shared/contractorApplication";
import {
  BusyButton,
  DataTable,
  EmptyState,
  ErrorNote,
  Loading,
  Modal,
  PdfLink,
  StatCard,
  StatusBadge,
} from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { cslbLookupUrl, formatBytes } from "@/lib/contractorApplicationForm";
import { useFormatters } from "@/lib/format";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearCpqActionError,
  decideContractorApplication,
  fetchAdminContractorApplication,
  reopenContractorApplication,
  requestContractorApplicationInfo,
  reviewContractorApplication,
  reviewContractorDocument,
  sendContractorApplication,
} from "@/store/slices/adminContractorApplicationSlice";
import CpqSummary from "./CpqSummary";

type DocRow = {
  key: ContractorApplicationDocType;
  requirement: "core" | "approval";
  doc: ContractorApplicationDocument | null;
};

type Dialog =
  | { kind: "info" }
  | { kind: "approve" }
  | { kind: "deny" }
  | { kind: "reopen" }
  | { kind: "reject"; docId: number }
  | null;

const triOptions = ["", "yes", "no"] as const;
const toTri = (v: boolean | null) => (v == null ? "" : v ? "yes" : "no");
const fromTri = (v: string) => (v === "" ? null : v === "yes");

/** Admin prequalification review (contractor detail page, anchor `#application`). */
export default function AdminApplicationPanel({
  contractorId,
  onContractorChanged,
}: {
  contractorId: number;
  /** Decisions can flip the contractor's account status — let the page refetch. */
  onContractorChanged?: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const canWrite = useAdminCan("approvals");
  const { view, loading, error, busy, actionError, missingDocs } = useAppSelector(
    (s) => s.adminContractorApplication,
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [allowMissing, setAllowMissing] = useState(false);
  const [infoDocs, setInfoDocs] = useState<ContractorApplicationDocType[]>([]);

  useEffect(() => {
    void dispatch(fetchAdminContractorApplication(contractorId));
  }, [dispatch, contractorId]);

  // Deep link from staff emails (`/admin/contractors/:id#application`).
  useEffect(() => {
    if (view && window.location.hash === "#application") {
      document.getElementById("application")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [view]);

  const app = view?.application ?? null;
  const reqs = view?.requirements ?? null;

  const docRows: DocRow[] = useMemo(() => {
    if (!reqs || !view) return [];
    const rows: DocRow[] = [];
    for (const r of reqs.docs) {
      if (!r.applicable) continue;
      const docs = view.documents.filter((d) => d.doc_type === r.key);
      if (!docs.length) rows.push({ key: r.key, requirement: r.requirement, doc: null });
      for (const d of docs) rows.push({ key: r.key, requirement: r.requirement, doc: d });
    }
    return rows;
  }, [reqs, view]);

  const outstanding = docRows.filter((r) => !r.doc || r.doc.status === "rejected").map((r) => r.key);

  const open = (d: Dialog) => {
    dispatch(clearCpqActionError());
    setNote("");
    setMessage("");
    setAllowMissing(false);
    if (d?.kind === "info") setInfoDocs([...new Set(outstanding)]);
    setDialog(d);
  };

  const run = async (thunkResult: Promise<{ type: string }>, changesContractor = false) => {
    const r = await thunkResult;
    if (!r.type.endsWith("/fulfilled")) return;
    setDialog(null);
    if (changesContractor) onContractorChanged?.();
  };

  if (loading && !view) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!view) return null;

  const status = app?.status;
  const decidable = status === "submitted" || status === "in_review" || status === "needs_info";
  const fileHref = (docId: number) => `/api/admin/contractors/${contractorId}/application/documents/${docId}/file`;

  return (
    <section className="pf-section cpq-admin" id="application">
      <div className="cpq-admin-head">
        <h2 className="pf-h2">{t("cpq.admin.title")}</h2>
        <div className="pf-actions">
          {app ? <PdfLink path={`/admin/contractors/${contractorId}/application/pdf`} /> : null}
          {canWrite && status !== "denied" ? (
            <BusyButton
              icon={Send}
              label={t(app?.sent_at ? "cpq.admin.resend" : "cpq.admin.send")}
              busyLabel={t("pf.busy.sending")}
              busy={busy === "send"}
              onClick={() => void dispatch(sendContractorApplication({ id: contractorId }))}
            />
          ) : null}
        </div>
      </div>
      <ErrorNote error={dialog ? null : actionError} />

      {!app ? (
        <div className="pf-card">
          <EmptyState messageKey="cpq.admin.none" />
        </div>
      ) : (
        <>
          <div className="pf-stats">
            <StatCard
              labelKey="cpq.admin.status"
              value={<StatusBadge group="cpqStatus" value={app.status} />}
              hint={app.application_number}
            />
            <StatCard labelKey="cpq.admin.sentAt" value={fmt.date(app.sent_at)} />
            <StatCard labelKey="cpq.submittedAt" value={fmt.date(app.submitted_at)} />
            <StatCard
              labelKey="cpq.admin.dueAt"
              value={fmt.date(app.due_at)}
              tone={app.due_at && new Date(app.due_at) < new Date() && !app.submitted_at ? "alert" : undefined}
            />
            <StatCard
              labelKey="cpq.admin.docsOutstanding"
              value={outstanding.length}
              tone={outstanding.length ? "gold" : undefined}
            />
          </div>

          {app.status === "needs_info" && app.info_request_note ? (
            <p className="cpq-callout cpq-callout--info">
              <MessageSquareWarning size={16} aria-hidden /> {app.info_request_note}
            </p>
          ) : null}

          {/* Office use (paper form's last block) */}
          <div className="pf-card cpq-office">
            <h3 className="cpq-panel-title">
              <ShieldCheck size={16} aria-hidden /> {t("cpq.admin.officeUse")}
            </h3>
            <div className="cpq-grid">
              <label className="pf-field">
                <span>{t("cpq.admin.licenseVerified")}</span>
                <select
                  value={toTri(app.office.license_verified)}
                  disabled={!canWrite || !decidable || busy === "review"}
                  onChange={(e) =>
                    void dispatch(
                      reviewContractorApplication({ id: contractorId, license_verified: fromTri(e.target.value) }),
                    )
                  }
                >
                  {triOptions.map((o) => (
                    <option key={o} value={o}>
                      {o ? t(`pf.${o}`) : "—"}
                    </option>
                  ))}
                </select>
                {app.data.licensing.cslb_license_number ? (
                  <a
                    className="text-link"
                    href={cslbLookupUrl(app.data.licensing.cslb_license_number)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} aria-hidden /> {t("cpq.admin.cslbLookup")}
                  </a>
                ) : null}
              </label>
              <label className="pf-field">
                <span>{t("cpq.admin.insuranceVerified")}</span>
                <select
                  value={toTri(app.office.insurance_verified)}
                  disabled={!canWrite || !decidable || busy === "review"}
                  onChange={(e) =>
                    void dispatch(
                      reviewContractorApplication({ id: contractorId, insurance_verified: fromTri(e.target.value) }),
                    )
                  }
                >
                  {triOptions.map((o) => (
                    <option key={o} value={o}>
                      {o ? t(`pf.${o}`) : "—"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pf-field cpq-span-2">
                <span>{t("cpq.admin.reviewedBy")}</span>
                <p className="pf-muted">
                  {app.office.reviewed_by_name || "—"}
                  {app.office.reviewed_at ? ` · ${fmt.date(app.office.reviewed_at)}` : ""}
                </p>
              </div>
            </div>
            {app.office.decision_notes ? (
              <p className="pf-muted cpq-notes">{app.office.decision_notes}</p>
            ) : null}
            {canWrite ? (
              <div className="pf-actions">
                {decidable ? (
                  <>
                    <BusyButton
                      tone="gold"
                      icon={Check}
                      label={t("cpq.admin.approve")}
                      onClick={() => open({ kind: "approve" })}
                    />
                    <BusyButton icon={MessageSquareWarning} label={t("cpq.admin.requestInfo")} onClick={() => open({ kind: "info" })} />
                    <BusyButton tone="danger" icon={X} label={t("cpq.admin.deny")} onClick={() => open({ kind: "deny" })} />
                  </>
                ) : null}
                {status !== "draft" ? (
                  <BusyButton icon={RotateCcw} label={t("cpq.admin.reopen")} onClick={() => open({ kind: "reopen" })} />
                ) : null}
              </div>
            ) : null}
          </div>

          <h3 className="cpq-panel-title">
            <FileText size={16} aria-hidden /> {t("cpq.admin.documents")}
          </h3>
          <DataTable<DocRow>
            rows={docRows}
            rowKey={(r) => (r.doc ? `d${r.doc.id}` : `m-${r.key}`)}
            emptyKey="cpq.admin.noDocs"
            columns={[
              {
                key: "doc",
                headerKey: "cpq.admin.colDocument",
                render: (r) => (
                  <span className="cpq-admin-doc">
                    {t(`cpq.doc.${r.key}`)}
                    <small className={r.requirement === "core" ? "cpq-req-chip is-core" : "cpq-req-chip"}>
                      {t(r.requirement === "core" ? "cpq.docs.reqCore" : "cpq.docs.reqApproval")}
                    </small>
                  </span>
                ),
              },
              {
                key: "file",
                headerKey: "cpq.admin.colFile",
                render: (r) =>
                  !r.doc ? (
                    <span className="cpq-missing">{t("cpq.admin.missing")}</span>
                  ) : r.doc.redacted ? (
                    <span className="pf-muted">{t("cpq.admin.restricted")}</span>
                  ) : (
                    <a className="text-link cpq-file-link" href={fileHref(r.doc.id)} target="_blank" rel="noreferrer">
                      <Eye size={13} aria-hidden /> {r.doc.file_name}
                      <small className="pf-muted"> · {formatBytes(r.doc.size_bytes)}</small>
                    </a>
                  ),
              },
              {
                key: "expires",
                headerKey: "cpq.admin.colExpires",
                render: (r) => {
                  const exp = r.doc?.expires_on;
                  if (!exp) return "—";
                  const days = Math.floor((new Date(`${exp}T00:00:00`).getTime() - Date.now()) / 86_400_000);
                  return (
                    <span className={days < 0 ? "cpq-exp is-expired" : days <= 30 ? "cpq-exp is-soon" : "cpq-exp"}>
                      {exp}
                    </span>
                  );
                },
              },
              {
                key: "status",
                headerKey: "pf.status",
                render: (r) =>
                  r.doc ? (
                    <span className="cpq-admin-docstatus">
                      <StatusBadge group="cpqDocStatus" value={r.doc.status} />
                      {r.doc.review_note ? <small className="pf-muted">{r.doc.review_note}</small> : null}
                    </span>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "actions",
                headerKey: "pf.actions",
                className: "pf-col-actions",
                render: (r) =>
                  canWrite && r.doc && !["approved", "denied"].includes(status || "") ? (
                    <span className="pf-table-actions">
                      {r.doc.status !== "accepted" ? (
                        <BusyButton
                          icon={Check}
                          label={t("cpq.admin.accept")}
                          className="pf-btn--sm pf-btn--nowrap"
                          busy={busy === "document"}
                          onClick={() =>
                            void dispatch(
                              reviewContractorDocument({ id: contractorId, docId: r.doc!.id, status: "accepted" }),
                            )
                          }
                        />
                      ) : null}
                      {r.doc.status !== "rejected" ? (
                        <BusyButton
                          icon={X}
                          tone="danger"
                          label={t("cpq.admin.reject")}
                          className="pf-btn--sm pf-btn--nowrap"
                          onClick={() => open({ kind: "reject", docId: r.doc!.id })}
                        />
                      ) : null}
                    </span>
                  ) : null,
              },
            ]}
          />

          <h3 className="cpq-panel-title">{t("cpq.admin.answers")}</h3>
          <CpqSummary
            data={app.data}
            collapsible
            missing={reqs?.missing_fields ?? []}
            redactedSections={app.financial_redacted ? ["financial"] : []}
          />

          {app.signer.signed_at ? (
            <div className="pf-card cpq-signed">
              <h3 className="cpq-panel-title">{t("cpq.admin.signature")}</h3>
              {app.signer.signature_image ? (
                <img className="cpq-signature-img" src={app.signer.signature_image} alt={t("cpq.admin.signatureAlt")} />
              ) : null}
              <dl className="cpq-status-meta">
                <div>
                  <dt>{t("cpq.sign.name")}</dt>
                  <dd>
                    {app.signer.signer_name}
                    {app.signer.signer_title ? ` · ${app.signer.signer_title}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>{t("cpq.admin.signedAt")}</dt>
                  <dd>{fmt.eventDateTime(app.signer.signed_at)}</dd>
                </div>
                <div>
                  <dt>{t("cpq.admin.signedFrom")}</dt>
                  <dd className="cpq-ua" title={app.signer.signed_user_agent || ""}>
                    {app.signer.signed_ip || "—"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          <details className="cpq-summary-section">
            <summary className="cpq-summary-head">{t("cpq.admin.activity", { count: view.events.length })}</summary>
            <ol className="cpq-events">
              {view.events.map((e) => (
                <li key={e.id}>
                  <span className="cpq-event-kind">{t(`cpq.event.${e.kind}`, { defaultValue: e.kind })}</span>
                  <span className="pf-muted">
                    {fmt.date(e.created_at)} · {e.actor_name || t(`cpq.actor.${e.actor_type}`)}
                  </span>
                  {e.note ? <span className="cpq-event-note">{e.note}</span> : null}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      <Modal open={dialog?.kind === "info"} titleKey="cpq.admin.requestInfo" onClose={() => setDialog(null)}>
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("cpq.admin.infoNote")}</span>
            <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <fieldset className="pf-multicheck">
            <legend>{t("cpq.admin.infoDocs")}</legend>
            <div className="pf-multicheck-options">
              {CONTRACTOR_DOC_SPECS.filter((s) => reqs?.docs.find((r) => r.key === s.key)?.applicable).map((s) => {
                const on = infoDocs.includes(s.key);
                return (
                  <label key={s.key} className={on ? "pf-chip-check is-on" : "pf-chip-check"}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setInfoDocs(on ? infoDocs.filter((k) => k !== s.key) : [...infoDocs, s.key])
                      }
                    />
                    <span>{t(`cpq.doc.${s.key}`)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <ErrorNote error={actionError} />
          <BusyButton
            tone="gold"
            icon={Send}
            label={t("cpq.admin.sendRequest")}
            busy={busy === "requestInfo"}
            disabled={note.trim().length < 5}
            onClick={() =>
              void run(
                dispatch(
                  requestContractorApplicationInfo({ id: contractorId, note: note.trim(), doc_types: infoDocs }),
                ),
              )
            }
          />
        </div>
      </Modal>

      <Modal open={dialog?.kind === "approve"} titleKey="cpq.admin.approveTitle" onClose={() => setDialog(null)}>
        <div className="pf-form">
          <p className="pf-muted">{t("cpq.admin.approveBody")}</p>
          {app && (!app.office.license_verified || !app.office.insurance_verified) ? (
            <p className="cpq-callout cpq-callout--warn">{t("errors.applicationVerifyFirst")}</p>
          ) : null}
          {outstanding.length || missingDocs.length ? (
            <>
              <p className="cpq-callout cpq-callout--warn">
                {t("cpq.admin.approveMissing")}{" "}
                {[...new Set([...outstanding, ...missingDocs])].map((k) => t(`cpq.doc.${k}`)).join(", ")}
              </p>
              <label className="pf-check">
                <input type="checkbox" checked={allowMissing} onChange={(e) => setAllowMissing(e.target.checked)} />
                <span>{t("cpq.admin.allowMissing")}</span>
              </label>
            </>
          ) : null}
          <label className="pf-field">
            <span>{t("cpq.admin.internalNotes")}</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ErrorNote error={actionError} />
          <BusyButton
            tone="gold"
            icon={Check}
            label={t("cpq.admin.approve")}
            busyLabel={t("pf.busy.approving")}
            busy={busy === "decision"}
            disabled={allowMissing && note.trim().length < 5}
            onClick={() =>
              void run(
                dispatch(
                  decideContractorApplication({
                    id: contractorId,
                    decision: "approved",
                    notes: note.trim() || null,
                    allow_missing: allowMissing,
                  }),
                ),
                true,
              )
            }
          />
        </div>
      </Modal>

      <Modal open={dialog?.kind === "deny"} titleKey="cpq.admin.denyTitle" onClose={() => setDialog(null)}>
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("cpq.admin.internalNotes")}</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="pf-field">
            <span>{t("cpq.admin.messageToContractor")}</span>
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            <small className="pf-hint">{t("cpq.admin.messageHint")}</small>
          </label>
          <ErrorNote error={actionError} />
          <BusyButton
            tone="danger"
            icon={X}
            label={t("cpq.admin.deny")}
            busy={busy === "decision"}
            onClick={() =>
              void run(
                dispatch(
                  decideContractorApplication({
                    id: contractorId,
                    decision: "denied",
                    notes: note.trim() || null,
                    message: message.trim() || null,
                  }),
                ),
                true,
              )
            }
          />
        </div>
      </Modal>

      <Modal open={dialog?.kind === "reopen"} titleKey="cpq.admin.reopenTitle" onClose={() => setDialog(null)}>
        <div className="pf-form">
          <p className="pf-muted">{t("cpq.admin.reopenBody")}</p>
          <label className="pf-field">
            <span>{t("cpq.admin.infoNote")}</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ErrorNote error={actionError} />
          <BusyButton
            icon={RotateCcw}
            label={t("cpq.admin.reopen")}
            busy={busy === "reopen"}
            disabled={note.trim().length < 5}
            onClick={() =>
              void run(dispatch(reopenContractorApplication({ id: contractorId, note: note.trim() })), true)
            }
          />
        </div>
      </Modal>

      <Modal open={dialog?.kind === "reject"} titleKey="cpq.admin.rejectTitle" onClose={() => setDialog(null)}>
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("cpq.admin.rejectNote")}</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ErrorNote error={actionError} />
          <BusyButton
            tone="danger"
            icon={X}
            label={t("cpq.admin.reject")}
            busy={busy === "document"}
            disabled={!note.trim()}
            onClick={() =>
              dialog?.kind === "reject" &&
              void run(
                dispatch(
                  reviewContractorDocument({
                    id: contractorId,
                    docId: dialog.docId,
                    status: "rejected",
                    review_note: note.trim(),
                  }),
                ),
              )
            }
          />
        </div>
      </Modal>
    </section>
  );
}
