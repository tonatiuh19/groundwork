import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, HelpCircle, Search, SendHorizontal, Sparkles, UserRound } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { askAssistant, fetchAffiliateFaqs, fetchAssistantHistory } from "@/store/slices/affiliateHelpSlice";
import { ErrorNote, Loading } from "@/components/portal/kit";
import { cn } from "@/lib/cn";

/**
 * Affiliate help: searchable FAQ (EN/ES) + an assistant that answers only from
 * the affiliate's agreement and this FAQ. Questions it can't answer go to the
 * team (shown as "Sent to the team").
 */
export default function AffiliateHelpPanel({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { faqs, faqsLoading, messages, assistantEnabled, asking, askError } = useAppSelector((s) => s.affiliateHelp);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void dispatch(fetchAffiliateFaqs());
    void dispatch(fetchAssistantHistory());
  }, [dispatch]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, asking]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return faqs
      .map((f) => ({
        id: f.id,
        question: (lang === "es" && f.question_es) || f.question_en,
        answer: (lang === "es" && f.answer_es) || f.answer_en,
      }))
      .filter((f) => !needle || `${f.question} ${f.answer}`.toLowerCase().includes(needle));
  }, [faqs, q, lang]);

  const send = () => {
    const message = draft.trim();
    if (message.length < 2 || asking) return;
    setDraft("");
    void dispatch(askAssistant({ message, lang }));
  };

  return (
    <div className={cn("gw-help", compact && "gw-help--compact")}>
      <section className="gw-help__faq" aria-labelledby="gw-faq-title">
        <div className="gw-help__head">
          <HelpCircle size={18} aria-hidden />
          <h2 id="gw-faq-title" className="pf-h2">
            {t("affHelp.faqTitle")}
          </h2>
        </div>
        <label className="gw-help__search">
          <Search size={15} aria-hidden />
          <input value={q} placeholder={t("affHelp.search")} onChange={(e) => setQ(e.target.value)} />
        </label>
        {faqsLoading && !faqs.length ? <Loading /> : null}
        <ul className="gw-faq">
          {items.map((f) => (
            <li key={f.id} className={cn("gw-faq__item", open === f.id && "is-open")}>
              <button type="button" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>
                <span>{f.question}</span>
                <ChevronDown size={16} aria-hidden />
              </button>
              {open === f.id ? <p>{f.answer}</p> : null}
            </li>
          ))}
          {!faqsLoading && !items.length ? <li className="pf-muted">{t("affHelp.noMatch")}</li> : null}
        </ul>
      </section>

      <section className="gw-assistant" aria-labelledby="gw-assistant-title">
        <div className="gw-help__head">
          <Sparkles size={18} aria-hidden />
          <h2 id="gw-assistant-title" className="pf-h2">
            {t("affHelp.assistantTitle")}
          </h2>
        </div>
        <p className="pf-hint">{t("affHelp.assistantLead")}</p>
        <div className="gw-assistant__log" ref={listRef} aria-live="polite">
          {!messages.length ? <p className="gw-assistant__empty">{t("affHelp.assistantEmpty")}</p> : null}
          {messages.map((m) => (
            <div key={m.id} className={cn("gw-bubble", m.role === "user" ? "is-me" : "is-bot")}>
              {m.role === "assistant" ? (
                <span className="gw-bubble__who" aria-hidden>
                  <Sparkles size={12} />
                </span>
              ) : (
                <span className="gw-bubble__who" aria-hidden>
                  <UserRound size={12} />
                </span>
              )}
              <p>{m.content}</p>
              {m.handoff ? <span className="gw-bubble__handoff">{t("affHelp.handedOff")}</span> : null}
            </div>
          ))}
          {asking ? (
            <div className="gw-bubble is-bot is-typing" aria-label={t("affHelp.thinking")}>
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>
        <ErrorNote error={askError} />
        {assistantEnabled ? (
          <form
            className="gw-assistant__compose"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              rows={2}
              maxLength={1500}
              value={draft}
              placeholder={t("affHelp.askPlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className="pf-btn pf-btn--gold" disabled={asking || draft.trim().length < 2} aria-label={t("affHelp.send")}>
              <SendHorizontal size={16} aria-hidden />
            </button>
          </form>
        ) : (
          <p className="gw-onboard-note">{t("affHelp.assistantOff")}</p>
        )}
        <p className="gw-assistant__fine">{t("affHelp.disclaimer")}</p>
      </section>
    </div>
  );
}
