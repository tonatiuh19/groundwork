import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchContractorProjects } from "@/store/slices/contractorPortalSlice";
import { DataTable, ErrorNote, PageHeader, StatusBadge } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

export default function ContractorProjects() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { projects, loading, error } = useAppSelector((s) => s.contractorPortal);

  useEffect(() => {
    void dispatch(fetchContractorProjects());
  }, [dispatch]);

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.projects" leadKey="ctr.projectsLead" />
      <ErrorNote error={error} />
      <DataTable
        rows={projects}
        loading={loading}
        emptyKey="ctr.noProjects"
        rowKey={(p) => p.public_id}
        onRowClick={(p) => navigate(`/contractor/projects/${p.public_id}`)}
        columns={[
          { key: "id", headerKey: "pf.project", render: (p) => <strong>{p.public_id}</strong> },
          { key: "address", headerKey: "pf.address", render: (p) => `${p.property_address || "—"}${p.property_city ? `, ${p.property_city}` : ""}` },
          { key: "client", headerKey: "pf.client", render: (p) => p.client_name },
          { key: "plan", headerKey: "pf.plan", render: (p) => p.plan_name || "—" },
          { key: "status", headerKey: "pf.status", render: (p) => <StatusBadge group="milestone" value={p.milestone} /> },
          { key: "budget", headerKey: "ctr.budget", render: (p) => fmt.money(p.budget_cents) },
          { key: "drawn", headerKey: "ctr.drawn", render: (p) => fmt.money(p.drawn_cents) },
        ]}
      />
    </div>
  );
}
