import { useEffect, useRef } from "react";
import { FileUp, Send, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContractorApplicationTemplates } from "@shared/contractorApplication";
import { BusyButton, ErrorNote, Loading, Modal } from "@/components/portal/kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchCpqTemplates,
  previewBulkApplications,
  removeCpqTemplate,
  resetBulkApplications,
  sendBulkApplications,
  uploadCpqTemplate,
} from "@/store/slices/adminContractorApplicationSlice";

const TEMPLATE_KINDS: Array<keyof ContractorApplicationTemplates> = [
  "master_contractor_agreement",
  "background_check_authorization",
];

function TemplateRow({ kind }: { kind: keyof ContractorApplicationTemplates }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { templates, templateBusy } = useAppSelector((s) => s.adminContractorApplication);
  const ref = useRef<HTMLInputElement>(null);
  const url = templates?.[kind] ?? null;
  return (
    <li className="cpq-template">
      <div>
        <p className="cpq-doc-title">{t(`cpq.doc.${kind}`)}</p>
        {url ? (
          <a className="text-link" href={url} target="_blank" rel="noreferrer">
            {t("cpq.tools.viewTemplate")}
          </a>
        ) : (
          <p className="pf-hint">{t("cpq.tools.noTemplate")}</p>
        )}
      </div>
      <div className="pf-actions">
        <input
          ref={ref}
          type="file"
          accept="application/pdf"
          className="sr-only"
          aria-label={t(`cpq.doc.${kind}`)}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void dispatch(uploadCpqTemplate({ kind, file }));
          }}
        />
        <BusyButton
          icon={FileUp}
          label={t(url ? "cpq.tools.replace" : "cpq.tools.upload")}
          busy={templateBusy === kind}
          onClick={() => ref.current?.click()}
        />
        {url ? (
          <BusyButton
            icon={Trash2}
            tone="danger"
            label={t("cpq.tools.remove")}
            disabled={templateBusy === kind}
            onClick={() => void dispatch(removeCpqTemplate(kind))}
          />
        ) : null}
      </div>
    </li>
  );
}

/** Contractors list → "Prequalification": bulk-send to existing contractors + signable templates. */
export default function PrequalificationToolsModal({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { bulk, templateError } = useAppSelector((s) => s.adminContractorApplication);

  useEffect(() => {
    if (!open) return;
    dispatch(resetBulkApplications());
    void dispatch(previewBulkApplications());
    void dispatch(fetchCpqTemplates());
  }, [open, dispatch]);

  return (
    <Modal open={open} titleKey="cpq.tools.title" onClose={onClose}>
      <div className="pf-form cpq-tools">
        <section>
          <h3 className="cpq-panel-title">{t("cpq.tools.bulkTitle")}</h3>
          <p className="pf-muted">{t("cpq.tools.bulkBody")}</p>
          {bulk.loading ? <Loading /> : null}
          {bulk.preview ? (
            <>
              <p>
                <strong>{t("cpq.tools.bulkCount", { count: bulk.preview.count })}</strong>
              </p>
              {bulk.preview.sample.length ? (
                <ul className="cpq-tools-sample">
                  {bulk.preview.sample.map((c) => (
                    <li key={c.id}>
                      {c.company || `${c.first_name} ${c.last_name}`} <span className="pf-muted">· {c.email}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          {bulk.result ? (
            <p className="cpq-callout cpq-callout--info" role="status">
              {t("cpq.tools.bulkResult", { sent: bulk.result.sent, failed: bulk.result.failed })}
            </p>
          ) : null}
          <ErrorNote error={bulk.error} />
          <BusyButton
            tone="gold"
            icon={Send}
            label={t("cpq.tools.bulkSend")}
            busyLabel={t("pf.busy.sending")}
            busy={bulk.sending}
            disabled={!bulk.preview?.count || !!bulk.result}
            onClick={async () => {
              const r = await dispatch(sendBulkApplications());
              if (sendBulkApplications.fulfilled.match(r)) onSent();
            }}
          />
        </section>
        <section>
          <h3 className="cpq-panel-title">{t("cpq.tools.templatesTitle")}</h3>
          <p className="pf-muted">{t("cpq.tools.templatesBody")}</p>
          <ul className="cpq-template-list">
            {TEMPLATE_KINDS.map((k) => (
              <TemplateRow key={k} kind={k} />
            ))}
          </ul>
          <ErrorNote error={templateError} />
        </section>
      </div>
    </Modal>
  );
}
