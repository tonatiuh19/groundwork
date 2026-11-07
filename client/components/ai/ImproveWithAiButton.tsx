import { useState } from "react";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiImproveKind } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { improveDraft } from "@/store/slices/aiWriteSlice";
import { cn } from "@/lib/cn";

/**
 * "Improve with AI" for any staff composer: rewrites the draft in place (same language, same
 * placeholders, links and numbers) and offers Undo. Nothing is sent: the person still taps Send.
 */
export default function ImproveWithAiButton({
  value,
  onChange,
  kind,
  disabled,
  compact,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  kind: AiImproveKind;
  disabled?: boolean;
  /** Icon-only button (tight toolbars on phones); the label stays as the accessible name. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unavailable = useAppSelector((s) => s.aiWrite.unavailable);
  const plain = value.replace(/<[^>]+>/g, " ").trim();
  // Undo only while the box still holds the AI's text (typing over it makes the new text the draft).
  const canUndo = undo && undo.after === value;

  const run = async () => {
    setError(null);
    setBusy(true);
    const r = await dispatch(improveDraft({ text: value, kind }));
    setBusy(false);
    if (improveDraft.fulfilled.match(r)) {
      setUndo({ before: value, after: r.payload });
      onChange(r.payload);
    } else if (r.payload !== "errors.aiUnavailable") setError(String(r.payload || "errors.aiRewriteFailed"));
  };

  // Not set up yet: a calm "Coming soon" badge instead of an error (never calls the server again this session).
  if (unavailable && !canUndo) {
    return (
      <span className={cn("gw-ai-improve", className)}>
        <span className={cn("gw-ai-improve__btn is-soon", compact && "is-compact")} role="note" aria-label={`${t("ai.improve")} · ${t("ai.comingSoon")}`} title={t("ai.comingSoonHint")}>
          <Sparkles size={14} aria-hidden />
          <span className="gw-ai-improve__soon" data-short={t("ai.soon")}>{t("ai.comingSoon")}</span>
        </span>
      </span>
    );
  }

  return (
    <span className={cn("gw-ai-improve", className)}>
      {canUndo ? (
        <button type="button" className="gw-ai-improve__btn is-undo" onClick={() => { onChange(undo.before); setUndo(null); }} disabled={disabled}>
          <Undo2 size={14} aria-hidden /> <span>{t("ai.undo")}</span>
        </button>
      ) : (
        <button
          type="button"
          className={cn("gw-ai-improve__btn", compact && "is-compact")}
          onClick={() => void run()}
          disabled={disabled || busy || plain.length < 3}
          aria-label={t("ai.improve")}
          title={t("ai.improveHint")}
        >
          {busy ? <Loader2 size={14} className="spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
          {compact ? null : <span>{busy ? t("ai.improving") : t("ai.improve")}</span>}
        </button>
      )}
      {error ? (
        <span className="gw-ai-improve__err" role="alert">
          {t(error)}
        </span>
      ) : null}
    </span>
  );
}
