import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearAdminSaveError, fetchAdminCommissions } from "@/store/slices/adminPortalSlice";
import {
  DataTable,
  ErrorNote,
  FilterSelect,
  PageHeader,
  StatusBadge,
  enumOptions,
} from "@/components/portal/kit";
import { CommissionActions } from "@/components/portal/AdminActions";
import { useFormatters } from "@/lib/format";

const STATUSES = ["pending", "approved", "paid", "void"] as const;

export default function AdminCommissions() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { items, loading, error } = useAppSelector((s) => s.adminPortal.commissions);
  const { saveError } = useAppSelector((s) => s.adminPortal);
  const [status, setStatus] = useState("");

  const load = () => void dispatch(fetchAdminCommissions({ status: status || undefined }));
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.commissions" leadKey="admin.commissionsLead" />
      <div className="pf-filters">
        <FilterSelect
          value={status}
          onChange={setStatus}
          ariaLabel={t("pf.status")}
          allLabel={t("admin.filterAllStatuses")}
          options={enumOptions(t, "commStatus", STATUSES)}
        />
      </div>
      <ErrorNote error={error || saveError} />
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noCommissions"
        rowKey={(c) => c.id}
        columns={[
          {
            key: "aff",
            headerKey: "admin.affiliate",
            render: (c) => (
              <>
                <strong>{c.affiliate_name}</strong>
                <br />
                <span className="pf-muted">{c.affiliate_email}</span>
              </>
            ),
          },
          {
            key: "project",
            headerKey: "pf.project",
            render: (c) => (
              <>
                <Link className="text-link" to={`/admin/projects/${c.project_public_id}`}>{c.project_public_id}</Link>
                <br />
                <span className="pf-muted">{c.client_name}</span>
              </>
            ),
          },
          { key: "sqft", headerKey: "pf.sqft", render: (c) => c.sq_ft ?? "—" },
          { key: "amount", headerKey: "pf.amount", render: (c) => <strong>{fmt.money(c.amount_cents)}</strong> },
          { key: "expected", headerKey: "aff.expectedPay", render: (c) => fmt.date(c.paid_at || c.expected_pay_at) },
          { key: "notes", headerKey: "pf.notes", render: (c) => c.notes || "—" },
          { key: "status", headerKey: "pf.status", render: (c) => <StatusBadge group="commStatus" value={c.status} /> },
          { key: "act", headerKey: "pf.actions", render: (c) => <CommissionActions commission={c} onDone={load} /> },
        ]}
      />
    </div>
  );
}
