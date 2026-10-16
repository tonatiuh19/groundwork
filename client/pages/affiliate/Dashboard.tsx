import AffiliateLinkCard from "@/components/affiliate/AffiliateLinkCard";
import { AffiliateAppointmentsCard } from "@/components/portal/PortalAppointments";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAffiliateOverview } from "@/store/slices/affiliatePortalSlice";
import { ErrorNote, Loading, PageHeader, StatCard } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import OnboardingBanner from "@/components/affiliate/OnboardingBanner";

export default function Dashboard() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { overview, loading, error } = useAppSelector((s) => s.affiliatePortal);

  useEffect(() => {
    void dispatch(fetchAffiliateOverview());
  }, [dispatch]);

  const s = overview?.stats;

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalDash.affiliateTitle" leadKey="portalDash.affiliateBody" />
      <AffiliateAppointmentsCard />
      <OnboardingBanner />
      <ErrorNote error={error} />
      {loading && !overview ? <Loading /> : null}
      {overview && s ? (
        <>
          <AffiliateLinkCard />
          <div className="pf-stats">
            <StatCard labelKey="aff.clicks" value={s.clicks} />
            <StatCard labelKey="aff.leads" value={s.leads} />
            <StatCard labelKey="aff.clients" value={s.clients} to="/affiliate/clients" />
            <StatCard labelKey="aff.inProcess" value={s.in_process} />
            <StatCard labelKey="aff.closed" value={s.closed} tone="gold" />
            <StatCard
              labelKey="aff.commissionPending"
              value={fmt.money(s.commission_pending_cents + s.commission_approved_cents)}
              hint={t("aff.payoutHint", { days: s.payout_days })}
              to="/affiliate/commissions"
            />
            <StatCard labelKey="aff.commissionPaid" value={fmt.money(s.commission_paid_cents)} tone="gold" />
          </div>
        </>
      ) : null}
    </div>
  );
}
