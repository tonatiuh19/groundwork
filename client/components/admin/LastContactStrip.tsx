import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MessageSquare, Phone } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLastTouch } from "@/store/slices/recordsSlice";
import LeadTouchCell from "@/components/admin/leads/LeadTouchCell";
import { conversationsComposeUrl, conversationsDialUrl } from "@/lib/conversationDeepLink";

/**
 * Top of a client / affiliate / contractor page: when we last texted and
 * called this person (opens the thread), plus quick Text and Call buttons.
 */
export default function LastContactStrip({ phone, name }: { phone: string | null | undefined; name: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const touch = useAppSelector((s) => (phone ? s.records.touches[phone] : undefined));
  useEffect(() => {
    if (phone) void dispatch(fetchLastTouch(phone));
  }, [dispatch, phone]);
  if (!phone) return null;
  return (
    <section className="gw-lastcontact" aria-label={t("lastContact.aria")}>
      <div className="gw-lastcontact__item">
        <span className="gw-lastcontact__label">{t("admin.leadLastText")}</span>
        <LeadTouchCell touch={touch?.last_sms} kind="sms" />
      </div>
      <div className="gw-lastcontact__item">
        <span className="gw-lastcontact__label">{t("admin.leadLastCall")}</span>
        <LeadTouchCell touch={touch?.last_call} kind="call" />
      </div>
      <div className="gw-lastcontact__actions">
        <Link className="pf-btn pf-btn--sm pf-btn--gold" to={conversationsComposeUrl({ phone, name })}>
          <MessageSquare size={14} aria-hidden /> {t("lastContact.text")}
        </Link>
        <Link className="pf-btn pf-btn--sm" to={conversationsDialUrl({ phone })}>
          <Phone size={14} aria-hidden /> {t("lastContact.call")}
        </Link>
      </div>
    </section>
  );
}
