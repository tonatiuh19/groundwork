import { Modal } from "@/components/portal/Modal";
import { useTranslation } from "react-i18next";

/**
 * Shows a rendered email (subject + body) exactly as the recipient gets it, in a sandboxed iframe.
 * Nothing is sent from here; pass `footer` for the real send action.
 */
export default function EmailPreviewModal({ preview, onClose, footer }: { preview: { subject: string; html: string } | null; onClose: () => void; footer?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Modal open={Boolean(preview)} titleKey="emailPreview.title" onClose={onClose}>
      {preview ? (
        <div className="email-preview">
          <p className="email-preview__subject">
            <span>{t("emailPreview.subject")}</span>
            {preview.subject}
          </p>
          <iframe className="email-preview__frame" title={t("emailPreview.title")} sandbox="" srcDoc={preview.html} />
          <p className="pf-hint">{t("emailPreview.notSent")}</p>
          {footer ? <div className="pf-actions">{footer}</div> : null}
        </div>
      ) : null}
    </Modal>
  );
}
