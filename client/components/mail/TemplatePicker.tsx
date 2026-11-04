import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import type { ConversationTemplate } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchMailTemplates } from "@/store/slices/mailSlice";
import { markConversationTemplateUsed } from "@/store/slices/conversationsSlice";
import { applyConversationTemplateVars, buildConversationMergeVars } from "@/lib/conversationTemplateVars";

/** Composer "Templates": pick an email template (EN or ES); {{first_name}} etc. are filled from the recipient. */
export default function TemplatePicker({
  firstName,
  lastName,
  onPick,
}: {
  firstName?: string | null;
  lastName?: string | null;
  onPick: (t: { subject: string | null; html: string }) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const templates = useAppSelector((s) => s.mail.templates.filter((x) => x.is_active));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void dispatch(fetchMailTemplates());
  }, [dispatch]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const use = (x: ConversationTemplate, lang: "en" | "es") => {
    const vars = buildConversationMergeVars({ first_name: firstName, last_name: lastName });
    const body = lang === "es" && x.body_es ? x.body_es : x.body_en;
    const subject = lang === "es" && x.subject_es ? x.subject_es : x.subject_en;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    onPick({
      subject: subject ? applyConversationTemplateVars(subject, vars) : null,
      html: esc(applyConversationTemplateVars(body, vars))
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join(""),
    });
    void dispatch(markConversationTemplateUsed(x.id));
    setOpen(false);
  };

  return (
    <div className="gw-tplpick" ref={ref}>
      <button type="button" className="pf-btn pf-btn--sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        <FileText size={14} aria-hidden /> {t("mail.templates")}
      </button>
      {open ? (
        <div className="gw-tplpick__menu" role="menu">
          {!templates.length ? <p className="pf-muted gw-tplpick__empty">{t("mail.noTemplates")}</p> : null}
          {templates.map((x) => (
            <div key={x.id} className="gw-tplpick__item" role="none">
              <span className="gw-tplpick__text">
                <strong>{x.title}</strong>
                <small>{x.subject_en}</small>
              </span>
              <span className="gw-tplpick__langs">
                <button type="button" role="menuitem" onClick={() => use(x, "en")}>
                  EN
                </button>
                {x.body_es ? (
                  <button type="button" role="menuitem" onClick={() => use(x, "es")}>
                    ES
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
