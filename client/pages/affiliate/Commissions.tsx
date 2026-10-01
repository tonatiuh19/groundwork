import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAffiliateCommissions,
  fetchAffiliateOverview,
} from "@/store/slices/affiliatePortalSlice";
import { DataTable, ErrorNote, PageHeader, StatCard, StatusBadge } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

export default function AffiliateCommissions() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { commissions, overview, loading, error } = useAppSelector((s) => s.affiliatePortal);

  useEffect(() => {
    void dispatch(fetchAffiliateCommissions());
    void dispatch(fetchAffiliateOverview());
  }, [dispatch]);

  const s = overview?.stats;

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.commissions" leadKey="aff.commissionsLead" />
      <ErrorNote error={error} />
      {s ? (
        <div className="pf-stats">
          <StatCard labelKey="aff.commissionPending" value={fmt.money(s.commission_pending_cents)} hint={t("aff.payoutHint", { days: s.payout_days })} />
          <StatCard labelKey="aff.commissionApproved" value={fmt.money(s.commission_approved_cents)} />
          <StatCard labelKey="aff.commissionPaid" value={fmt.money(s.commission_paid_cents)} tone="gold" />
        </div>
      ) : null}
      <DataTable
        rows={commissions}
        loading={loading}
        emptyKey="aff.noCommissions"
        rowKey={(c) => c.id}
        columns={[
          { key: "project", headerKey: "pf.project", render: (c) => c.project_public_id },
          { key: "client", headerKey: "pf.client", render: (c) => c.client_name },
          { key: "sqft", headerKey: "pf.sqft", render: (c) => c.sq_ft ?? "—" },
          { key: "amount", headerKey: "pf.amount", render: (c) => <strong>{fmt.money(c.amount_cents)}</strong> },
          { key: "status", headerKey: "pf.status", render: (c) => <StatusBadge group="commStatus" value={c.status} /> },
          { key: "expected", headerKey: "aff.expectedPay", render: (c) => fmt.date(c.paid_at || c.expected_pay_at) },
        ]}
      />
    </div>
  );
}
