import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  fetchAdminAffiliates,
  fetchAdminCommissions,
} from "@/store/slices/adminPortalSlice";
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
const ROLES = ["direct", "closer", "parent", "grandparent"] as const;

export default function AdminCommissions() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { items, loading, error } = useAppSelector((s) => s.adminPortal.commissions);
  const affiliates = useAppSelector((s) => s.adminPortal.affiliates.items);
  const { saveError } = useAppSelector((s) => s.adminPortal);
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [affiliateId, setAffiliateId] = useState("");

  useEffect(() => {
    void dispatch(fetchAdminAffiliates({ limit: 200, offset: 0 }));
  }, [dispatch]);

  const load = () =>
    void dispatch(
      fetchAdminCommissions({
        status: status || undefined,
        role: role || undefined,
        affiliate_id: affiliateId || undefined,
      }),
    );
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, [status, role, affiliateId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <FilterSelect
          value={role}
          onChange={setRole}
          ariaLabel={t("admin.commissionRole")}
          allLabel={t("admin.filterAllRoles")}
          options={enumOptions(t, "commRole", ROLES)}
        />
        <FilterSelect
          value={affiliateId}
          onChange={setAffiliateId}
          ariaLabel={t("admin.affiliate")}
          allLabel={t("admin.filterAllAffiliates")}
          options={affiliates.map((a) => ({
            value: String(a.id),
            label: `${a.first_name} ${a.last_name}`,
          }))}
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
            key: "role",
            headerKey: "admin.commissionRole",
            render: (c) =>
              c.role ? <StatusBadge group="commRole" value={c.role} /> : "—",
          },
          {
            key: "project",
            headerKey: "pf.project",
            render: (c) => (
              <>
                <Link className="text-link" to={`/admin/projects/${c.project_public_id}`}>
                  {c.project_public_id}
                </Link>
                <br />
                <span className="pf-muted">{c.client_name}</span>
              </>
            ),
          },
          { key: "sqft", headerKey: "pf.sqft", render: (c) => c.sq_ft ?? "—" },
          {
            key: "amount",
            headerKey: "pf.amount",
            render: (c) => <strong>{fmt.money(c.amount_cents)}</strong>,
          },
          {
            key: "expected",
            headerKey: "aff.expectedPay",
            render: (c) => fmt.date(c.paid_at || c.expected_pay_at),
          },
          { key: "notes", headerKey: "pf.notes", render: (c) => c.notes || "—" },
          {
            key: "status",
            headerKey: "pf.status",
            render: (c) => <StatusBadge group="commStatus" value={c.status} />,
          },
          {
            key: "act",
            headerKey: "pf.actions",
            render: (c) => <CommissionActions commission={c} onDone={load} />,
          },
        ]}
      />
    </div>
  );
}
