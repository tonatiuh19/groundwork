import { useTranslation } from "react-i18next";
import { ArrowRight, Handshake, Home } from "lucide-react";
import type { PublicAffiliateCard } from "@shared/api";
import InvitedByCard from "./InvitedByCard";

export type EnrollRole = "homeowner" | "partner";

/** First screen on an affiliate's link: homeowner (ADU for my property) or realtor / partner (refer clients). */
export default function EnrollRoleChooser({ affiliate, onPick }: { affiliate: PublicAffiliateCard; onPick: (r: EnrollRole) => void }) {
  const { t } = useTranslation();
  const name = affiliate.first_name;
  const options: Array<{ role: EnrollRole; icon: typeof Home; title: string; body: string }> = [
    { role: "homeowner", icon: Home, title: t("enrollRole.homeownerTitle"), body: t("enrollRole.homeownerBody") },
    { role: "partner", icon: Handshake, title: t("enrollRole.partnerTitle"), body: t("enrollRole.partnerBody", { name }) },
  ];
  return (
    <div className="enroll-layout enroll-layout--center">
      <div className="enroll-panel enroll-role">
        <InvitedByCard affiliate={affiliate} />
        <h1 className="enroll-role__title">{t("enrollRole.title", { name })}</h1>
        <p className="enroll-role__lead">{t("enrollRole.lead")}</p>
        <div className="enroll-role__grid" role="list">
          {options.map(({ role, icon: Icon, title, body }) => (
            <button key={role} type="button" role="listitem" className={`enroll-role__card is-${role}`} onClick={() => onPick(role)}>
              <span className="enroll-role__icon" aria-hidden>
                <Icon size={22} />
              </span>
              <span className="enroll-role__text">
                <strong>{title}</strong>
                <span>{body}</span>
              </span>
              <ArrowRight size={18} className="enroll-role__go" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
