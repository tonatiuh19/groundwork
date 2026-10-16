import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchContractorDraws, fetchContractorProjects } from "@/store/slices/contractorPortalSlice";
import { DataTable, ErrorNote, PageHeader, StatCard, StatusBadge } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import PrequalificationBanner from "@/components/contractorApplication/PrequalificationBanner";
import ContractorMembership from "@/components/contractor/ContractorMembership";

export default function Dashboard() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { projects, draws, loading, error } = useAppSelector((s) => s.contractorPortal);

  useEffect(() => {
    void dispatch(fetchContractorProjects());
    void dispatch(fetchContractorDraws());
  }, [dispatch]);

  const active = projects.filter((p) => ["contracted", "in_build"].includes(p.milestone));
  const openDraws = draws.filter((d) => ["submitted", "approved"].includes(d.status));

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalDash.contractorTitle" leadKey="portalDash.contractorBody" />
      <PrequalificationBanner />
      <ErrorNote error={error} />
      <div className="pf-stats">
        <StatCard labelKey="ctr.activeProjects" value={active.length} to="/contractor/projects" />
        <StatCard labelKey="ctr.totalProjects" value={projects.length} />
        <StatCard
          labelKey="ctr.openDraws"
          value={openDraws.length}
          hint={fmt.money(openDraws.reduce((s, d) => s + d.amount_cents, 0))}
          to="/contractor/draws"
          tone={openDraws.length ? "gold" : undefined}
        />
      </div>
      <h2 className="pf-h2">{t("ctr.recentProjects")}</h2>
      <DataTable
        rows={projects.slice(0, 5)}
        loading={loading}
        emptyKey="ctr.noProjects"
        rowKey={(p) => p.public_id}
        columns={[
          {
            key: "id",
            headerKey: "pf.project",
            render: (p) => (
              <Link className="text-link" to={`/contractor/projects/${p.public_id}`}>
                {p.public_id}
              </Link>
            ),
          },
          { key: "address", headerKey: "pf.address", render: (p) => p.property_address || "—" },
          { key: "milestone", headerKey: "pf.status", render: (p) => <StatusBadge group="milestone" value={p.milestone} /> },
        ]}
      />
      <ContractorMembership mode="portal" />
    </div>
  );
}
