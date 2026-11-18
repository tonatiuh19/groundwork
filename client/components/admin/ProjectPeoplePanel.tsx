import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HardHat, Handshake, Home, Users } from "lucide-react";
import type { AdminProject } from "@shared/api";
import LastContactStrip from "@/components/admin/LastContactStrip";

type Person = { key: string; icon: typeof Home; roleKey: string; name: string; to: string; phone: string | null; email: string | null };

/**
 * Project page → People: the homeowner, affiliate and contractor, each with last text / call /
 * email and Text · Call · Email (opens their Conversations thread or Mail, same as their own page).
 */
export default function ProjectPeoplePanel({ p }: { p: AdminProject }) {
  const { t } = useTranslation();
  const people: Person[] = [
    { key: "client", icon: Home, roleKey: "projectPeople.homeowner", name: p.client_name, to: `/admin/clients/${p.client_id}`, phone: p.client_phone ?? null, email: p.client_email || null },
    ...(p.affiliate_id
      ? [{ key: "affiliate", icon: Handshake, roleKey: "projectPeople.affiliate", name: p.affiliate_name || "", to: `/admin/affiliates/${p.affiliate_id}`, phone: p.affiliate_phone ?? null, email: p.affiliate_email ?? null }]
      : []),
    ...(p.contractor_id
      ? [{ key: "contractor", icon: HardHat, roleKey: "projectPeople.contractor", name: p.contractor_name || "", to: `/admin/contractors/${p.contractor_id}`, phone: p.contractor_phone ?? null, email: p.contractor_email ?? null }]
      : []),
  ];
  return (
    <section className="pf-section gw-project-people" aria-labelledby="gw-project-people-h">
      <div className="pf-section-head">
        <h2 className="pf-h2" id="gw-project-people-h">
          <Users size={18} aria-hidden /> {t("projectPeople.title")}
        </h2>
      </div>
      <ul className="gw-project-people__list">
        {people.map((x) => (
          <li key={x.key} className="gw-project-people__row">
            <div className="gw-project-people__who">
              <x.icon size={16} aria-hidden />
              <span className="gw-project-people__role">{t(x.roleKey)}</span>
              <Link className="text-link gw-project-people__name" to={x.to}>
                {x.name}
              </Link>
            </div>
            {x.phone || x.email ? <LastContactStrip phone={x.phone} email={x.email} name={x.name} /> : <p className="pf-hint">{t("projectPeople.noContact")}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
