import { AlertCircle, Check, CheckCheck, Clock, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/** Delivery ticks / labels for outbound SMS (Twilio provider_status). */
export function ConversationMessageStatus({
  providerStatus,
  errorMessage,
  direction,
}: {
  providerStatus?: string | null;
  errorMessage?: string | null;
  direction: string;
}) {
  const { t } = useTranslation();
  if (direction !== "outbound") return null;

  const status = String(providerStatus || "").toLowerCase();
  const failed =
    !!errorMessage ||
    ["failed", "undelivered"].includes(status);

  if (failed) {
    return (
      <span
        className="gw-msg-status gw-msg-status--failed"
        title={errorMessage || t("conversations.status.failed")}
      >
        <XCircle className="w-3.5 h-3.5" aria-hidden />
        {t("conversations.status.failed")}
      </span>
    );
  }

  if (["delivered", "read"].includes(status)) {
    return (
      <span
        className="gw-msg-status gw-msg-status--ok"
        title={t("conversations.status.delivered")}
      >
        <CheckCheck className="w-3.5 h-3.5" aria-hidden />
      </span>
    );
  }

  if (["sent", "receiving", "received"].includes(status)) {
    return (
      <span
        className={cn("gw-msg-status")}
        title={t("conversations.status.sent")}
      >
        <Check className="w-3.5 h-3.5" aria-hidden />
      </span>
    );
  }

  if (["queued", "accepted", "sending", "scheduled"].includes(status) || !status) {
    return (
      <span
        className="gw-msg-status"
        title={t("conversations.status.queued")}
      >
        <Clock className="w-3.5 h-3.5" aria-hidden />
      </span>
    );
  }

  return (
    <span className="gw-msg-status" title={status}>
      <AlertCircle className="w-3.5 h-3.5" aria-hidden />
    </span>
  );
}
