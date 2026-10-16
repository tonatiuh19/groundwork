import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { Modal } from "@/components/portal/Modal";
import AffiliateLinkCard from "@/components/affiliate/AffiliateLinkCard";

/** Header button on every affiliate page: opens the link card (copy, QR, flyer). */
export default function AffiliateLinkButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="gw-mylink-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Link2 size={15} aria-hidden /> <span>{t("affLink.myLink")}</span>
      </button>
      <Modal open={open} titleKey="affLink.myLink" onClose={() => setOpen(false)}>
        <AffiliateLinkCard variant="compact" />
      </Modal>
    </>
  );
}
