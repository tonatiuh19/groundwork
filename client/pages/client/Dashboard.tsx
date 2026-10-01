import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchClientOverview } from "@/store/slices/clientPortalSlice";
import {
  EmptyState,
  ErrorNote,
  Loading,
  MilestoneTracker,
  PageHeader,
  StatusBadge,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

export default function Dashboard() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { overview, loading, error } = useAppSelector((s) => s.clientPortal);
  const user = useAppSelector((s) => s.portalAuth.client.user);

  useEffect(() => {
    void dispatch(fetchClientOverview());
  }, [dispatch]);

  const projects = overview?.projects ?? [];

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalDash.clientTitle" leadKey="portalDash.clientBody" />
      {user ? (
        <p className="pf-greeting">{t("cli.greeting", { name: user.first_name })}</p>
      ) : null}
      <ErrorNote error={error} />
      {loading && !overview ? <Loading /> : null}
      {overview && !projects.length ? <EmptyState messageKey="cli.noProject" /> : null}
      <div className="pf-card-grid">
        {projects.map((p) => (
          <article key={p.public_id} className="pf-card">
            <div className="pf-card-top">
              <div>
                <p className="pf-kicker">{p.public_id}</p>
                <h2>{p.property_address || t("cli.addressPending")}</h2>
                {p.plan ? <p className="pf-muted">{p.plan.name}</p> : null}
              </div>
              <StatusBadge group="milestone" value={p.milestone} />
            </div>
            <MilestoneTracker milestone={p.milestone} />
            <dl className="pf-dl">
              <div>
                <dt>{t("cli.lastUpdate")}</dt>
                <dd>{fmt.date(p.milestone_changed_at)}</dd>
              </div>
              <div>
                <dt>{t("cli.financing")}</dt>
                <dd>
                  <StatusBadge group="loan" value={p.loan_status} />
                </dd>
              </div>
              {p.contractor_name ? (
                <div>
                  <dt>{t("cli.builder")}</dt>
                  <dd>{p.contractor_name}</dd>
                </div>
              ) : null}
            </dl>
            <Link className="text-link pf-link" to="/client/project">
              {t("cli.viewDetails")} <ArrowRight size={14} />
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
