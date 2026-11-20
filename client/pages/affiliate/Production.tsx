import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Home } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchMyProduction } from "@/store/slices/addendaSlice";
import { ErrorNote, Loading, PageHeader, StatusBadge } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

/**
 * Affiliate portal → Production: for each signed special agreement, the sign-ups from its events and the
 * projects it covers (homeowner as first name + last initial, street name only), with the fee per project.
 */
export default function AffiliateProduction() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const { production, error } = useAppSelector((s) => s.addenda);
  useEffect(() => {
    void dispatch(fetchMyProduction());
  }, [dispatch]);
  return (
    <div className="portal-page">
      <PageHeader titleKey="addendum.productionTitle" leadKey="addendum.productionLead" />
      <ErrorNote error={error} />
      {production === null ? <Loading /> : null}
      {production && !production.length ? <p className="pf-muted">{t("addendum.productionNone")}</p> : null}
      {(production ?? []).map((p) => {
        const earned = p.projects.reduce((n, x) => n + (x.fee_cents && x.fee_status !== "void" ? x.fee_cents : 0), 0);
        const paid = p.projects.reduce((n, x) => n + (x.fee_cents && x.fee_status === "paid" ? x.fee_cents : 0), 0);
        return (
          <section key={p.addendum.id} className="pf-section">
            <div className="pf-section-head">
              <h2 className="pf-h2">{p.addendum.title}</h2>
              <StatusBadge group="addendum.status" value={p.addendum.status} />
            </div>
            <p className="pf-hint">
              {fmt.money(p.addendum.rate_cents_per_sqft)} / {t("addendum.sqft")}
              {p.addendum.events.length ? ` · ${p.addendum.events.map((e) => (lang === "es" ? e.title_es : e.title)).join(", ")}` : ""}
            </p>
            <div className="gw-production__stats">
              <div className="gw-production__stat">
                <strong>{p.signups.length}</strong>
                {t("addendum.statSignups")}
              </div>
              <div className="gw-production__stat">
                <strong>{p.projects.length}</strong>
                {t("addendum.statProjects")}
              </div>
              <div className="gw-production__stat">
                <strong>{fmt.money(earned)}</strong>
                {t("addendum.statEarned")}
              </div>
              <div className="gw-production__stat">
                <strong>{fmt.money(paid)}</strong>
                {t("addendum.statPaid")}
              </div>
            </div>
            <h3 className="pf-h3">
              <Home size={15} aria-hidden /> {t("addendum.projectsTitle")}
            </h3>
            {p.projects.length ? (
              <ul className="gw-production__list">
                {p.projects.map((x, i) => (
                  <li key={i}>
                    <span>
                      <strong>{x.name}</strong>
                      {x.street ? <small className="pf-muted"> · {x.street}</small> : null}
                    </span>
                    <span>
                      {t(`milestone.${x.milestone}`, { defaultValue: x.milestone })}
                      {x.sq_ft ? ` · ${x.sq_ft} ${t("addendum.sqft")}` : ""}
                      {x.fee_cents != null ? ` · ${fmt.money(x.fee_cents)} (${t(`commStatus.${x.fee_status}`, { defaultValue: x.fee_status || "" })})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pf-muted">{t("addendum.noProjectsYet")}</p>
            )}
            {p.addendum.events.length ? (
              <>
                <h3 className="pf-h3">
                  <CalendarDays size={15} aria-hidden /> {t("addendum.signupsTitle")}
                </h3>
                {p.signups.length ? (
                  <ul className="gw-production__list">
                    {p.signups.map((s, i) => (
                      <li key={i}>
                        <strong>{s.name}</strong>
                        <span>
                          {s.at ? fmt.date(s.at) : ""}
                          {s.became_client ? ` · ${t("addendum.becameClient")}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pf-muted">{t("addendum.noSignups")}</p>
                )}
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
