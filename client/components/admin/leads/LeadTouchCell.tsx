import { ArrowDownLeft, ArrowUpRight, PhoneMissed } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { LeadTouch } from "@shared/api";
import { useFormatters } from "@/lib/format";

/** Conversations deep link for a thread (client / CRM contact / unknown number). */
export function threadUrl(thread: LeadTouch["thread"]): string | null {
  return thread ? `/admin/conversations?${thread.kind}=${thread.id}` : null;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Leads list "Last text" / "Last call": relative time with in/out arrow plus a
 * snippet (SMS) or duration / missed (call). Links to the thread in Conversations.
 */
export default function LeadTouchCell({ touch, kind }: { touch: LeadTouch | null | undefined; kind: "sms" | "call" }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  if (!touch) return <span className="pf-muted">{t("admin.leadNeverContacted")}</span>;
  const inbound = touch.direction === "inbound";
  const Arrow = inbound ? ArrowDownLeft : ArrowUpRight;
  const missed = kind === "call" && !touch.duration_sec;
  const detail =
    kind === "sms"
      ? touch.preview
      : missed
        ? t(inbound ? "admin.leadCallMissed" : "admin.leadCallNoAnswer")
        : mmss(touch.duration_sec || 0);
  const body = (
    <>
      <span
        className="gw-lead-touch-when"
        title={`${t(inbound ? "admin.leadTouchIn" : "admin.leadTouchOut")} · ${fmt.eventDateTime(touch.at)}`}
      >
        {missed ? (
          <PhoneMissed size={13} aria-label={t("admin.leadCallMissed")} />
        ) : (
          <Arrow size={13} aria-label={t(inbound ? "admin.leadTouchIn" : "admin.leadTouchOut")} />
        )}
        {fmt.relative(touch.at)}
      </span>
      {detail ? <span className="gw-lead-touch-detail">{detail}</span> : null}
    </>
  );
  const href = threadUrl(touch.thread);
  return href ? (
    <Link className={`gw-lead-touch${inbound ? " is-in" : ""}`} to={href}>
      {body}
    </Link>
  ) : (
    <span className={`gw-lead-touch${inbound ? " is-in" : ""}`}>{body}</span>
  );
}

/** "Last text" + "Last call" columns for any people list whose rows carry last_sms / last_call. */
// Rows are typed by each table; these columns only read last_sms / last_call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function touchColumns(): { key: string; headerKey: string; render: (row: any) => JSX.Element }[] {
  const get = (row: unknown) => row as { last_sms?: LeadTouch | null; last_call?: LeadTouch | null };
  return [
    { key: "last_sms", headerKey: "admin.leadLastText", render: (r) => <LeadTouchCell touch={get(r).last_sms} kind="sms" /> },
    { key: "last_call", headerKey: "admin.leadLastCall", render: (r) => <LeadTouchCell touch={get(r).last_call} kind="call" /> },
  ];
}
