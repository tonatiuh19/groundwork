import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { sendAffiliateLinkAdmin } from "@/store/slices/affiliateLinkSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";

/**
 * Affiliate record: the "you're approved, here's your link" message (email + text).
 * Shows when it was last sent and lets staff send it again (approved affiliates only).
 */
export default function AffiliateLinkSend({
  affiliate,
  onSent,
}: {
  affiliate: { id: number; status: string; link_sent_at?: string | null };
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const canSend = useAdminCan("approvals");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = affiliate.status === "active";

  return (
    <section className="gw-linksend" aria-label={t("affLinkSend.title")}>
      <div className="gw-linksend__copy">
        <strong>{t("affLinkSend.title")}</strong>
        <span className="pf-muted">
          {!active
            ? t("affLinkSend.afterApproval")
            : affiliate.link_sent_at
              ? t("affLinkSend.lastSent", { date: fmt.date(affiliate.link_sent_at) })
              : t("affLinkSend.never")}
        </span>
        <ErrorNote error={error} />
      </div>
      {canSend && active ? (
        <BusyButton
          tone="gold"
          icon={Send}
          label={affiliate.link_sent_at ? t("affLinkSend.resend") : t("affLinkSend.send")}
          doneLabel={t("affLinkSend.sent")}
          busy={busy}
          done={done}
          onClick={async () => {
            if (!window.confirm(t("affLinkSend.confirm"))) return;
            setBusy(true);
            setError(null);
            const r = await dispatch(sendAffiliateLinkAdmin(affiliate.id));
            setBusy(false);
            if (sendAffiliateLinkAdmin.fulfilled.match(r)) {
              setDone(true);
              onSent();
            } else setError(String(r.payload || "errors.server"));
          }}
        />
      ) : null}
    </section>
  );
}
