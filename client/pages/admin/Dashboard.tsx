import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MILESTONES } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminDashboard } from "@/store/slices/adminPortalSlice";
import { ErrorNote, Loading, PageHeader, StatCard } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

export default function Dashboard() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.dashboard);
  const canLeads = useAdminCan("leads");
  const canPeople = useAdminCan("people.read");

  useEffect(() => {
    void dispatch(fetchAdminDashboard());
  }, [dispatch]);

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalDash.adminTitle" leadKey="portalDash.adminBody" />
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : null}
      {data ? (
        <>
          <h2 className="pf-h2">{t("admin.queue")}</h2>
          <div className="pf-stats">
            {canLeads ? (
              <StatCard labelKey="admin.newLeads" value={data.leads_new} to="/admin/leads" tone={data.leads_new ? "alert" : undefined} />
            ) : null}
            {canPeople ? (
              <>
                <StatCard labelKey="admin.pendingAffiliates" value={data.affiliates_pending} to="/admin/affiliates" tone={data.affiliates_pending ? "alert" : undefined} />
                <StatCard labelKey="admin.invitedContractors" value={data.contractors_invited} to="/admin/contractors" />
              </>
            ) : null}
            <StatCard
              labelKey="admin.drawsAwaiting"
              value={data.draws_submitted}
              hint={fmt.money(data.draws_submitted_cents)}
              to="/admin/draws"
              tone={data.draws_submitted ? "alert" : undefined}
            />
          </div>

          <h2 className="pf-h2">{t("admin.pipeline")}</h2>
          <div className="pf-stats">
            {[...MILESTONES, "cancelled" as const].map((m) => (
              <StatCard key={m} labelKey={`milestone.${m}`} value={data.projects_by_milestone[m] || 0} to="/admin/projects" />
            ))}
          </div>

          {data.finance ? (
            <>
              <h2 className="pf-h2">{t("admin.finance")}</h2>
              <div className="pf-stats">
                <StatCard labelKey="admin.commissionsPending" value={fmt.money(data.finance.commissions_pending_cents)} to="/admin/commissions" />
                <StatCard labelKey="admin.commissionsApproved" value={fmt.money(data.finance.commissions_approved_cents)} to="/admin/commissions" />
                <StatCard labelKey="admin.commissionsPaid" value={fmt.money(data.finance.commissions_paid_cents)} />
                <StatCard labelKey="admin.closedProjects" value={data.finance.projects_closed} />
                <StatCard labelKey="admin.netProfitClosed" value={fmt.money(data.finance.net_profit_closed_cents)} tone="gold" />
                <StatCard labelKey="admin.avgPerSqft" value={fmt.money(data.finance.avg_net_profit_per_sqft_cents)} tone="gold" />
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
