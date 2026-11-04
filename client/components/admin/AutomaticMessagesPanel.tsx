import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, ChevronDown, Mail, MessageSquare } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAutomaticMessages } from "@/store/slices/recordsSlice";
import { formatMailFull } from "@/components/mail/mailFormat";
import { cn } from "@/lib/cn";

/**
 * Record pages: every automatic email / text the system sent this person (welcome,
 * approval, invites, reminders…). Also in their Conversations thread with an "Automatic" badge.
 */
export default function AutomaticMessagesPanel({ kind, id }: { kind: "client" | "lead" | "affiliate" | "contractor" | "contact"; id: number }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const list = useAppSelector((s) => s.records.automatic[`${kind}:${id}`]);
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? list || [] : (list || []).slice(0, 3);
  useEffect(() => {
    void dispatch(fetchAutomaticMessages({ kind, id }));
  }, [dispatch, kind, id]);
  return (
    <section className="pf-section gw-auto">
      <h2 className="gw-auto__title">
        <Bot size={17} aria-hidden /> {t("autoMsgs.title")}
        {list?.length ? <span className="gw-auto__count">{list.length}</span> : null}
      </h2>
      <p className="pf-muted">{t("autoMsgs.lead")}</p>
      {list && !list.length ? <p className="pf-muted">{t("autoMsgs.none")}</p> : null}
      <ul className="gw-auto__list">
        {shown.map((m) => (
          <li key={m.id} className={cn("gw-auto__item", open === m.id && "is-open")}>
            <button type="button" className="gw-auto__head" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
              <span className={cn("gw-auto__icon", `is-${m.channel}`)} aria-hidden>
                {m.channel === "email" ? <Mail size={14} /> : <MessageSquare size={14} />}
              </span>
              <span className="gw-auto__main">
                <strong>{m.channel === "email" ? m.subject || t("autoMsgs.email") : t("autoMsgs.text")}</strong>
                <small>
                  {m.to} · {formatMailFull(m.sent_at, i18n.language)}
                  {m.test_mode ? ` · ${t("autoMsgs.testMode")}` : ""}
                </small>
              </span>
              <ChevronDown size={15} className="gw-auto__chev" aria-hidden />
            </button>
            {open === m.id ? <p className="gw-auto__body">{m.preview}</p> : null}
          </li>
        ))}
      </ul>
      {list && list.length > 3 ? (
        <button type="button" className="gw-linkbtn" onClick={() => setAll(!all)}>
          {all ? t("autoMsgs.showLess") : t("autoMsgs.showAll", { count: list.length })}
        </button>
      ) : null}
    </section>
  );
}
