import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Ban, KeyRound, RefreshCw, ShieldCheck, ShieldHalf } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchSpamShieldLog } from "@/store/slices/spamShieldSlice";
import { ErrorNote } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

const VERDICT_ICON = { blocked: Ban, quarantined: ShieldHalf, code: KeyRound } as const;

/**
 * Settings → Spam shield: what our own shield stopped on the public forms in the last 30 days
 * (blocked bots, quarantined leads saved as Spam, bookings asked for a text code) and the latest 50,
 * with masked contact only. Rows older than 30 days are trimmed daily.
 */
export default function SpamShieldPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const { log, loading, error } = useAppSelector((s) => s.spamShield);
  useEffect(() => {
    void dispatch(fetchSpamShieldLog());
  }, [dispatch]);
  const sum = useMemo(() => {
    const out = { blocked: 0, quarantined: 0, code: 0 } as Record<"blocked" | "quarantined" | "code", number>;
    for (const r of log?.totals ?? []) out[r.verdict] += r.count;
    return out;
  }, [log]);
  return (
    <section className={cn("gw-shield-panel", className)} id="spam-shield">
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <ShieldCheck size={18} aria-hidden /> {t("shield.title")}
        </h2>
        <button type="button" className="pf-btn pf-btn--sm" disabled={loading} onClick={() => void dispatch(fetchSpamShieldLog())}>
          <RefreshCw size={14} aria-hidden className={loading ? "animate-spin" : undefined} /> {t("shield.refresh")}
        </button>
      </div>
      <p className="pf-hint">{t("shield.lead")}</p>
      <ErrorNote error={error} />
      <div className="gw-shield-stats">
        {(["blocked", "quarantined", "code"] as const).map((v) => {
          const Icon = VERDICT_ICON[v];
          return (
            <div key={v} className={cn("gw-shield-stat", `is-${v}`)}>
              <Icon size={18} aria-hidden />
              <strong>{sum[v]}</strong>
              <span>{t(`shield.v_${v}`)}</span>
            </div>
          );
        })}
      </div>
      {log && !log.recent.length ? <p className="pf-muted">{t("shield.empty")}</p> : null}
      {log?.recent.length ? (
        <ul className="gw-shield-list">
          {log.recent.map((r) => {
            const Icon = VERDICT_ICON[r.verdict];
            return (
              <li key={r.id} className={cn("gw-shield-row", `is-${r.verdict}`)}>
                <Icon size={15} aria-hidden />
                <span className="gw-shield-row__form">{t(`shield.form_${r.form}`, { defaultValue: r.form })}</span>
                <span className="gw-shield-row__why">{r.reasons.map((x) => t(`shield.r_${x}`, { defaultValue: x })).join(" · ")}</span>
                <span className="gw-shield-row__who">{r.contact || "—"}</span>
                <time className="gw-shield-row__at">{r.at ? fmt.eventDateTime(r.at) : "—"}</time>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
