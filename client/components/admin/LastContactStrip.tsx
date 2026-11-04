import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, MessageSquare, Phone } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLastTouch } from "@/store/slices/recordsSlice";
import { fetchLastEmail } from "@/store/slices/mailSlice";
import { formatMailTime } from "@/components/mail/mailFormat";
import LeadTouchCell from "@/components/admin/leads/LeadTouchCell";
import { conversationsComposeUrl, conversationsDialUrl } from "@/lib/conversationDeepLink";

/**
 * Top of a client / affiliate / contractor page: when we last texted and
 * called this person (opens the thread), plus quick Text and Call buttons.
 */
export default function LastContactStrip({ phone, email, name }: { phone: string | null | undefined; email?: string | null; name: string }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const touch = useAppSelector((s) => (phone ? s.records.touches[phone] : undefined));
  const lastEmail = useAppSelector((s) => (email ? s.mail.lastEmail[email] : undefined));
  const hasMail = useAppSelector((s) => Boolean(s.mail.status?.mailboxes.some((m) => m.can_send)));
  useEffect(() => {
    if (phone) void dispatch(fetchLastTouch(phone));
  }, [dispatch, phone]);
  useEffect(() => {
    if (email) void dispatch(fetchLastEmail(email));
  }, [dispatch, email]);
  if (!phone && !email) return null;
  return (
    <section className="gw-lastcontact" aria-label={t("lastContact.aria")}>
      {phone ? (
        <>
          <div className="gw-lastcontact__item">
            <span className="gw-lastcontact__label">{t("admin.leadLastText")}</span>
            <LeadTouchCell touch={touch?.last_sms} kind="sms" />
          </div>
          <div className="gw-lastcontact__item">
            <span className="gw-lastcontact__label">{t("admin.leadLastCall")}</span>
            <LeadTouchCell touch={touch?.last_call} kind="call" />
          </div>
        </>
      ) : null}
      {email ? (
        <div className="gw-lastcontact__item">
          <span className="gw-lastcontact__label">{t("lastContact.lastEmail")}</span>
          {lastEmail ? (
            <Link className="gw-lastcontact__email" to={`/admin/mail?folder=all&thread=${lastEmail.thread_id}`} title={lastEmail.preview}>
              <span>{lastEmail.direction === "inbound" ? t("lastContact.emailIn") : t("lastContact.emailOut")}</span> {formatMailTime(lastEmail.at, i18n.language)}
            </Link>
          ) : (
            <span className="pf-muted">{t("lastContact.never")}</span>
          )}
        </div>
      ) : null}
      <div className="gw-lastcontact__actions">
        {phone ? (
          <>
            <Link className="pf-btn pf-btn--sm pf-btn--gold" to={conversationsComposeUrl({ phone, name })}>
              <MessageSquare size={14} aria-hidden /> {t("lastContact.text")}
            </Link>
            <Link className="pf-btn pf-btn--sm" to={conversationsDialUrl({ phone })}>
              <Phone size={14} aria-hidden /> {t("lastContact.call")}
            </Link>
          </>
        ) : null}
        {email && hasMail ? (
          <Link className="pf-btn pf-btn--sm" to={`/admin/mail?compose=1&to=${encodeURIComponent(email)}`}>
            <Mail size={14} aria-hidden /> {t("lastContact.email")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
