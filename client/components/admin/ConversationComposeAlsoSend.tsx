import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { parseComposePhoneInput } from "@/lib/parseComposePhone";
import {
  dedupeAlsoRecipients,
  type AlsoRecipient,
} from "@/lib/conversationAlsoSend";

export type ComposeAlsoRecipient = AlsoRecipient;

/** Optional extra SMS destinations (manual phones). */
export function ConversationComposeAlsoSend({
  recipients,
  onChange,
  disabled,
}: {
  recipients: AlsoRecipient[];
  onChange: (next: AlsoRecipient[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const parsed = useMemo(() => parseComposePhoneInput(draft), [draft]);

  return (
    <div className="gw-also-send space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("conversations.alsoSendLead")}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="tel"
          className="pf-input flex-1 min-w-[10rem]"
          value={draft}
          disabled={disabled}
          placeholder={t("conversations.alsoSendPlaceholder")}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          disabled={disabled || !parsed}
          onClick={() => {
            if (!parsed) return;
            onChange(
              dedupeAlsoRecipients([
                ...recipients,
                {
                  key: parsed.phone,
                  phone: parsed.phone,
                  label: parsed.label,
                },
              ]),
            );
            setDraft("");
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          {t("conversations.alsoSendAdd")}
        </button>
      </div>
      {recipients.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {recipients.map((r) => (
            <li key={r.key} className="gw-chip flex items-center gap-1">
              <span className="truncate max-w-[10rem]">{r.label}</span>
              {!disabled && (
                <button
                  type="button"
                  className="pf-icon-btn"
                  aria-label={t("conversations.alsoSendRemove")}
                  onClick={() =>
                    onChange(recipients.filter((x) => x.key !== r.key))
                  }
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
