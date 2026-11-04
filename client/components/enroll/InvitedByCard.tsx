import { useTranslation } from "react-i18next";
import type { PublicAffiliateCard } from "@shared/api";

/** "Invited by Arely Moreno · The Arely Group": shown at the top of every path from an affiliate's link. */
export default function InvitedByCard({ affiliate }: { affiliate: PublicAffiliateCard }) {
  const { t } = useTranslation();
  const company = "company" in affiliate && affiliate.company ? String(affiliate.company) : null;
  return (
    <div className="enroll-invited">
      {affiliate.avatar_url ? (
        <img className="enroll-invited-avatar" src={affiliate.avatar_url} alt="" />
      ) : (
        <span className="enroll-invited-avatar enroll-invited-avatar--fallback" aria-hidden>
          {affiliate.initials}
        </span>
      )}
      <span className="enroll-invited-copy">
        <span className="enroll-invited-kicker">{t("enroll.invitedBy")}</span>
        <strong className="enroll-invited-name">
          {affiliate.first_name} {affiliate.last_name}
        </strong>
        {company ? <span className="enroll-invited-co">{company}</span> : null}
      </span>
    </div>
  );
}
