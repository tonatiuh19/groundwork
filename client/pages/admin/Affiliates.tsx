import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  fetchAdminAffiliates,
  updateAdminAffiliate,
} from "@/store/slices/adminPortalSlice";
import {
  BusyButton,
  CopyButton,
  DataTable,
  ErrorNote,
  FilterSelect,
  InlineSelect,
  ListPager,
  PageHeader,
  SearchBox,
  StatusBadge,
  enumOptions,
  useRowBusy,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const STATUSES = ["pending", "active", "inactive", "suspended"] as const;
const PAGE_SIZE = 50;

export default function AdminAffiliates() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.affiliates);
  const { saveError } = useAppSelector((s) => s.adminPortal);
  const canApprove = useAdminCan("approvals");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const rowBusy = useRowBusy();

  useEffect(() => {
    setOffset(0);
  }, [q, status]);

  const load = () =>
    void dispatch(
      fetchAdminAffiliates({
        q: q || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    );
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, [q, status, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatusFor = async (id: number, next: string) => {
    const flash = next === "active";
    await rowBusy.run(
      id,
      flash ? "approve" : "status",
      async () => {
        const result = await dispatch(updateAdminAffiliate({ id, patch: { status: next } }));
        return updateAdminAffiliate.fulfilled.match(result);
      },
      { flash, onFlashEnd: load },
    );
  };

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.affiliates" leadKey="admin.affiliatesLead" />
      <div className="pf-filters">
        <SearchBox onSearch={setQ} />
        <FilterSelect
          value={status}
          onChange={setStatus}
          ariaLabel={t("pf.status")}
          allLabel={t("admin.filterAllStatuses")}
          options={enumOptions(t, "accountStatus", STATUSES)}
        />
      </div>
      <ErrorNote error={error || saveError} />
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noAffiliates"
        rowKey={(a) => a.id}
        onRowClick={(a) => navigate(`/admin/affiliates/${a.id}`)}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (a) => (
              <>
                <strong>{a.first_name} {a.last_name}</strong>
                <br />
                <span className="pf-muted">{a.email}{a.phone ? ` · ${a.phone}` : ""}</span>
              </>
            ),
          },
          { key: "company", headerKey: "pf.company", render: (a) => a.company || "—" },
          { key: "code", headerKey: "aff.codeLabel", render: (a) => <code>{a.referral_code}</code> },
          { key: "clicks", headerKey: "aff.clicks", render: (a) => a.click_count },
          { key: "clients", headerKey: "aff.clients", render: (a) => a.client_count },
          { key: "date", headerKey: "pf.created", render: (a) => fmt.date(a.created_at) },
          {
            key: "status",
            headerKey: "pf.status",
            render: (a) =>
              canApprove ? (
                <InlineSelect
                  ariaLabel={t("pf.status")}
                  value={rowBusy.isDone(a.id, "approve") ? "active" : a.status}
                  options={enumOptions(t, "accountStatus", STATUSES)}
                  disabled={rowBusy.isRowLocked(a.id)}
                  onChange={(v) => void setStatusFor(a.id, v)}
                />
              ) : (
                <StatusBadge group="accountStatus" value={a.status} />
              ),
          },
          {
            key: "actions",
            headerKey: "pf.actions",
            render: (a) => {
              if (rowBusy.isDone(a.id, "approve") || (a.status === "pending" && canApprove)) {
                return (
                  <BusyButton
                    tone="gold"
                    icon={Check}
                    stopPropagation
                    label={t("admin.approve")}
                    busyLabel={t("pf.busy.approving")}
                    doneLabel={t("pf.done.approved")}
                    busy={rowBusy.isBusy(a.id, "approve")}
                    done={rowBusy.isDone(a.id, "approve")}
                    onClick={() => void setStatusFor(a.id, "active")}
                  />
                );
              }
              return (
                <CopyButton value={`${window.location.origin}/r/${a.slug || a.referral_code}`} />
              );
            },
          },
        ]}
      />
      <ListPager
        total={total}
        limit={PAGE_SIZE}
        offset={offset}
        loading={loading}
        onPageChange={setOffset}
      />
    </div>
  );
}
