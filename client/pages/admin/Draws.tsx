import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearAdminSaveError, fetchAdminDraws } from "@/store/slices/adminPortalSlice";
import {
  DataTable,
  ErrorNote,
  FilterSelect,
  PageHeader,
  StatusBadge,
  enumOptions,
} from "@/components/portal/kit";
import { DrawActions } from "@/components/portal/AdminActions";
import { useFormatters } from "@/lib/format";

const STATUSES = ["submitted", "approved", "rejected", "paid"] as const;

export default function AdminDraws() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { items, loading, error } = useAppSelector((s) => s.adminPortal.draws);
  const { saveError } = useAppSelector((s) => s.adminPortal);
  const [status, setStatus] = useState("");

  const load = () => void dispatch(fetchAdminDraws({ status: status || undefined }));
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.draws" leadKey="admin.drawsLead" />
      <div className="pf-filters">
        <FilterSelect
          value={status}
          onChange={setStatus}
          ariaLabel={t("pf.status")}
          allLabel={t("admin.filterAllStatuses")}
          options={enumOptions(t, "drawStatus", STATUSES)}
        />
      </div>
      <ErrorNote error={error || saveError} />
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noDraws"
        rowKey={(d) => d.id}
        columns={[
          {
            key: "project",
            headerKey: "pf.project",
            render: (d) => (
              <>
                <Link className="text-link" to={`/admin/projects/${d.project_public_id}`}>{d.project_public_id}</Link>
                <br />
                <span className="pf-muted">{d.property_address || "—"}</span>
              </>
            ),
          },
          { key: "ctr", headerKey: "admin.contractor", render: (d) => d.contractor_name || "—" },
          { key: "amount", headerKey: "pf.amount", render: (d) => <strong>{fmt.money(d.amount_cents)}</strong> },
          { key: "note", headerKey: "pf.notes", render: (d) => d.note || "—" },
          { key: "date", headerKey: "pf.date", render: (d) => fmt.date(d.created_at) },
          { key: "status", headerKey: "pf.status", render: (d) => <StatusBadge group="drawStatus" value={d.status} /> },
          { key: "act", headerKey: "pf.actions", render: (d) => <DrawActions draw={d} onDone={load} /> },
        ]}
      />
    </div>
  );
}
