import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, MessageSquare, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import DuplicatesPanel from "@/components/admin/DuplicatesPanel";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  fetchAdminAffiliates,
  updateAdminAffiliate,
} from "@/store/slices/adminPortalSlice";
import {
  BusyButton,
  DataTable,
  ErrorNote,
  FilterSelect,
  InlineSelect,
  ListPager,
  PageHeader,
  SearchBox,
  StatusBadge,
  TrackingLinkChip,
  enumOptions,
  useRowBusy,
} from "@/components/portal/kit";
import {
  ConfirmStatusChangeModal,
  type PendingStatusChange,
} from "@/components/portal/ConfirmStatusChangeModal";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useStatusQueryParam } from "@/hooks/useStatusQueryParam";
import { isDemotingAccountStatus } from "@/lib/accountStatus";
import {
  conversationsComposeUrl,
  conversationsDialUrl,
} from "@/lib/conversationDeepLink";

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
  const [status, setStatus] = useStatusQueryParam(STATUSES);
  const [offset, setOffset] = useState(0);
  const rowBusy = useRowBusy();
  const [pendingDemote, setPendingDemote] = useState<PendingStatusChange | null>(
    null,
  );

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

  const requestStatusChange = (
    id: number,
    from: string,
    to: string,
    name: string,
  ) => {
    if (isDemotingAccountStatus(from, to)) {
      setPendingDemote({ id, from, to, name });
      return;
    }
    void setStatusFor(id, to);
  };

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.affiliates" leadKey="admin.affiliatesLead" />
      <DuplicatesPanel entity="affiliate" />
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
          {
            key: "link",
            headerKey: "admin.trackingLinkCol",
            className: "pf-col-tracking",
            render: (a) => (
              <TrackingLinkChip slug={a.slug} referralCode={a.referral_code} />
            ),
          },
          {
            key: "parent",
            headerKey: "admin.parentAffiliate",
            render: (a) =>
              a.parent_name ? (
                <span className="pf-muted">{a.parent_name}</span>
              ) : (
                t("admin.topLevelAffiliate")
              ),
          },
          {
            key: "subs",
            headerKey: "admin.subCount",
            render: (a) => a.sub_count ?? 0,
          },
          { key: "clicks", headerKey: "aff.clicks", render: (a) => a.click_count },
          { key: "clients", headerKey: "aff.clients", render: (a) => a.client_count },
          { key: "date", headerKey: "pf.created", render: (a) => fmt.date(a.created_at) },
          {
            key: "status",
            headerKey: "pf.status",
            className: "pf-col-status",
            render: (a) =>
              canApprove ? (
                <InlineSelect
                  ariaLabel={t("pf.status")}
                  value={rowBusy.isDone(a.id, "approve") ? "active" : a.status}
                  options={enumOptions(t, "accountStatus", STATUSES)}
                  disabled={rowBusy.isRowLocked(a.id)}
                  onChange={(v) =>
                    requestStatusChange(
                      a.id,
                      rowBusy.isDone(a.id, "approve") ? "active" : a.status,
                      v,
                      `${a.first_name} ${a.last_name}`.trim(),
                    )
                  }
                />
              ) : (
                <StatusBadge group="accountStatus" value={a.status} />
              ),
          },
          {
            key: "actions",
            headerKey: "pf.actions",
            className: "pf-col-actions",
            render: (a) => {
              const name = `${a.first_name} ${a.last_name}`.trim();
              const showApprove =
                rowBusy.isDone(a.id, "approve") ||
                (a.status === "pending" && canApprove);
              return (
                <div
                  className="pf-table-actions gw-people-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {a.phone ? (
                    <>
                      <Link
                        className="pf-btn pf-btn--sm pf-btn--nowrap"
                        to={conversationsComposeUrl({
                          phone: a.phone,
                          name,
                        })}
                      >
                        <MessageSquare size={14} aria-hidden />
                        {t("conversations.messageClient")}
                      </Link>
                      <Link
                        className="pf-btn pf-btn--sm pf-btn--nowrap"
                        to={conversationsDialUrl({ phone: a.phone })}
                      >
                        <Phone size={14} aria-hidden />
                        {t("conversations.callClient")}
                      </Link>
                    </>
                  ) : null}
                  {showApprove ? (
                    <BusyButton
                      className="pf-btn--nowrap pf-btn--sm"
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
                  ) : null}
                </div>
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

      <ConfirmStatusChangeModal
        pending={pendingDemote}
        busy={
          pendingDemote
            ? rowBusy.isBusy(pendingDemote.id, "status")
            : false
        }
        onCancel={() => {
          if (pendingDemote && rowBusy.isBusy(pendingDemote.id, "status")) {
            return;
          }
          setPendingDemote(null);
        }}
        onConfirm={() => {
          if (!pendingDemote) return;
          const { id, to } = pendingDemote;
          void setStatusFor(id, to).then(() => setPendingDemote(null));
        }}
      />
    </div>
  );
}
