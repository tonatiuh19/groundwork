import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, Eye, FileUp, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CONTRACTOR_DOC_SPECS,
  CPQ_DOC_MAX_BYTES,
  CPQ_DOC_MIME_TYPES,
  contractorApplicationRequirements,
  type ContractorApplicationData,
  type ContractorApplicationDocType,
  type ContractorApplicationDocument,
  type ContractorApplicationPublicView,
  type ContractorApplicationStatus,
  type ContractorDocSpec,
} from "@shared/contractorApplication";
import { ErrorNote, StatusBadge } from "@/components/portal/kit";
import { cn } from "@/lib/cn";
import { CPQ_DOC_EXPIRY_SOURCE, cpqGet, formatBytes } from "@/lib/contractorApplicationForm";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearUploadError,
  removeContractorDocument,
  updateContractorDocumentExpiry,
  uploadContractorDocument,
} from "@/store/slices/contractorApplicationSlice";

/** Mirrors the API: approved files only take expiring-document renewals. */
export function cpqCanUpload(status: ContractorApplicationStatus, spec: ContractorDocSpec) {
  if (status === "denied") return false;
  if (status === "approved") return spec.expires;
  return true;
}

const REMOVABLE: ContractorApplicationStatus[] = ["draft", "needs_info", "submitted", "in_review"];

function DocRow({
  spec,
  requirement,
  docs,
  token,
  status,
  data,
  templateUrl,
  requested,
}: {
  spec: ContractorDocSpec;
  requirement: "core" | "approval";
  docs: ContractorApplicationDocument[];
  token: string;
  status: ContractorApplicationStatus;
  data: ContractorApplicationData;
  templateUrl: string | null;
  requested: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const upload = useAppSelector((s) => s.contractorApplication.uploads[spec.key]);
  const busyId = useAppSelector((s) => s.contractorApplication.docBusyId);
  const fileRef = useRef<HTMLInputElement>(null);
  const prefill = String(cpqGet(data, CPQ_DOC_EXPIRY_SOURCE[spec.key] || "") || "");
  const [expires, setExpires] = useState(docs[0]?.expires_on || prefill);
  const [localError, setLocalError] = useState<string | null>(null);
  const live = docs.filter((d) => d.status !== "rejected");
  const done = live.length > 0;
  const rejected = docs.find((d) => d.status === "rejected");
  const canUpload = cpqCanUpload(status, spec);
  const uploading = !!upload && !upload.error;

  const pick = (file: File | undefined) => {
    setLocalError(null);
    dispatch(clearUploadError(spec.key));
    if (!file) return;
    if (!(CPQ_DOC_MIME_TYPES as readonly string[]).includes(file.type)) {
      setLocalError("validation.documentFile");
      return;
    }
    if (file.size > CPQ_DOC_MAX_BYTES) {
      setLocalError("validation.documentTooLarge");
      return;
    }
    if (spec.expires && !expires) {
      setLocalError("validation.expirationRequired");
      return;
    }
    void dispatch(
      uploadContractorDocument({ token, docType: spec.key, file, expiresOn: spec.expires ? expires : null }),
    );
  };

  return (
    <li
      className={cn(
        "cpq-doc",
        done && "is-done",
        (rejected && !done) || requested ? "is-flagged" : null,
      )}
    >
      <div className="cpq-doc-head">
        <span className="cpq-doc-icon" aria-hidden>
          {done ? <CheckCircle2 size={18} /> : <FileUp size={18} />}
        </span>
        <div className="cpq-doc-copy">
          <p className="cpq-doc-title">{t(`cpq.doc.${spec.key}`)}</p>
          <p className="cpq-doc-meta">
            <span className={cn("cpq-req-chip", requirement === "core" && "is-core")}>
              {t(requirement === "core" ? "cpq.docs.reqCore" : "cpq.docs.reqApproval")}
            </span>
            {spec.multiple ? <span className="pf-muted">{t("cpq.docs.multiple")}</span> : null}
            {requested ? <span className="cpq-req-chip is-flag">{t("cpq.docs.requested")}</span> : null}
          </p>
          {templateUrl ? (
            <a className="text-link cpq-doc-template" href={templateUrl} target="_blank" rel="noreferrer">
              <Download size={13} aria-hidden /> {t("cpq.docs.downloadTemplate")}
            </a>
          ) : spec.template ? (
            <p className="pf-hint">{t("cpq.docs.templateComing")}</p>
          ) : null}
        </div>
      </div>

      {docs.length ? (
        <ul className="cpq-doc-files">
          {docs.map((d) => (
            <li key={d.id} className="cpq-doc-file">
              <span className="cpq-doc-file-name" title={d.file_name}>
                {d.file_name}
              </span>
              <span className="pf-muted">{formatBytes(d.size_bytes)}</span>
              {d.expires_on ? (
                <span className="pf-muted">{t("cpq.docs.expires", { date: d.expires_on })}</span>
              ) : null}
              <StatusBadge group="cpqDocStatus" value={d.status} />
              {d.status === "rejected" && d.review_note ? (
                <span className="cpq-doc-note">{d.review_note}</span>
              ) : null}
              <span className="cpq-doc-actions">
                <a
                  className="pf-btn pf-btn--sm"
                  href={`/api/public/contractor-application/${token}/documents/${d.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Eye size={14} aria-hidden /> {t("cpq.docs.view")}
                </a>
                {REMOVABLE.includes(status) && d.status !== "accepted" ? (
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm pf-btn--danger"
                    disabled={busyId === d.id}
                    onClick={() => void dispatch(removeContractorDocument({ token, id: d.id }))}
                  >
                    {busyId === d.id ? <Loader2 className="spin" size={14} aria-hidden /> : <Trash2 size={14} aria-hidden />}{" "}
                    {t("cpq.docs.remove")}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {canUpload ? (
        <div className="cpq-doc-upload">
          {spec.expires ? (
            <label className="pf-field cpq-doc-exp">
              <span>
                {t("cpq.docs.expiration")}
                <em className="pf-req" aria-hidden> *</em>
              </span>
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              {done && live[0] && expires && expires !== live[0].expires_on && !spec.multiple ? (
                <button
                  type="button"
                  className="pf-btn pf-btn--sm"
                  disabled={busyId === live[0].id}
                  onClick={() =>
                    void dispatch(updateContractorDocumentExpiry({ token, id: live[0].id, expires_on: expires }))
                  }
                >
                  {t("cpq.docs.saveDate")}
                </button>
              ) : null}
            </label>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept={CPQ_DOC_MIME_TYPES.join(",")}
            onChange={(e) => {
              pick(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
            aria-label={t(`cpq.doc.${spec.key}`)}
          />
          <button
            type="button"
            className={cn("pf-btn", !done && "pf-btn--gold", uploading && "pf-btn--busy")}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="spin" size={15} aria-hidden /> {t("cpq.docs.uploading", { pct: upload?.progress ?? 0 })}
              </>
            ) : (
              <>
                <FileUp size={15} aria-hidden />{" "}
                {done ? (spec.multiple ? t("cpq.docs.addFile") : t("cpq.docs.replace")) : t("cpq.docs.upload")}
              </>
            )}
          </button>
          {uploading ? (
            <span className="cpq-progress" aria-hidden>
              <span style={{ width: `${upload?.progress ?? 0}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}
      <ErrorNote error={localError || upload?.error || null} />
    </li>
  );
}

export default function CpqDocumentsStep({
  token,
  view,
  data,
}: {
  token: string;
  view: ContractorApplicationPublicView;
  /** Live (possibly unsaved) answers — drives conditional documents + expiry prefill. */
  data: ContractorApplicationData;
}) {
  const { t } = useTranslation();
  const docError = useAppSelector((s) => s.contractorApplication.docError);
  const status = view.application.status;
  const reqs = useMemo(() => contractorApplicationRequirements(data, view.templates), [data, view.templates]);
  const requested = new Set<ContractorApplicationDocType>(view.application.info_request_doc_types);
  const byKey = new Map(reqs.docs.map((r) => [r.key, r]));
  const applicable = CONTRACTOR_DOC_SPECS.filter((s) => byKey.get(s.key)?.applicable);
  const hidden = CONTRACTOR_DOC_SPECS.length - applicable.length;
  const docsFor = (k: ContractorApplicationDocType) => view.documents.filter((d) => d.doc_type === k);
  const have = (k: ContractorApplicationDocType) => docsFor(k).some((d) => d.status !== "rejected");
  const groups = (["core", "approval"] as const).map((req) => ({
    req,
    specs: applicable.filter((s) => byKey.get(s.key)?.requirement === req),
  }));
  const coreLeft = groups[0].specs.filter((s) => !have(s.key)).length;
  const total = applicable.length;
  const doneCount = applicable.filter((s) => have(s.key)).length;

  return (
    <div className="cpq-docs">
      <div className="cpq-docs-summary">
        <p>
          <strong>{t("cpq.docs.progress", { done: doneCount, total })}</strong>
        </p>
        <span className="cpq-progress cpq-progress--lg" aria-hidden>
          <span style={{ width: `${total ? Math.round((doneCount / total) * 100) : 0}%` }} />
        </span>
        <p className="pf-hint">
          {coreLeft
            ? t("cpq.docs.coreLeft", { count: coreLeft })
            : t("cpq.docs.coreDone")}{" "}
          {t("cpq.docs.formats")}
        </p>
      </div>
      <ErrorNote error={docError} />
      {groups.map((g) =>
        g.specs.length ? (
          <section key={g.req} className="cpq-docs-group">
            <h3 className="cpq-docs-group-title">
              {g.req === "core" ? (
                t("cpq.docs.groupCore")
              ) : (
                <>
                  <TriangleAlert size={15} aria-hidden /> {t("cpq.docs.groupApproval")}
                </>
              )}
            </h3>
            <ul className="cpq-doc-list">
              {g.specs.map((spec) => (
                <DocRow
                  key={spec.key}
                  spec={spec}
                  requirement={g.req}
                  docs={docsFor(spec.key)}
                  token={token}
                  status={status}
                  data={data}
                  templateUrl={spec.template ? view.templates[spec.template] : null}
                  requested={requested.has(spec.key)}
                />
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {hidden ? <p className="pf-hint">{t("cpq.docs.hiddenNA", { count: hidden })}</p> : null}
    </div>
  );
}
