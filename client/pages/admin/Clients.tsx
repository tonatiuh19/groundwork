import { useEffect, useRef, useState } from "react";
import { touchColumns } from "@/components/admin/leads/LeadTouchCell";
import DealStatusBadge from "@/components/portal/DealStatusBadge";
import { Link, useNavigate } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Check, Mail, MessageSquare, Phone, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import DuplicatesPanel from "@/components/admin/DuplicatesPanel";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  createAdminClient,
  fetchAdminAffiliates,
  fetchAdminClients,
  sendClientPortalInvite,
  updateAdminClient,
} from "@/store/slices/adminPortalSlice";
import {
  BusyButton,
  DataTable,
  ErrorNote,
  FilterSelect,
  HeaderAction,
  InlineSelect,
  ListPager,
  Modal,
  PageHeader,
  SearchBox,
  SelectField,
  StatusBadge,
  SubmitButton,
  TextField,
  enumOptions,
  useRowBusy,
} from "@/components/portal/kit";
import {
  ConfirmStatusChangeModal,
  type PendingStatusChange,
} from "@/components/portal/ConfirmStatusChangeModal";
import { useFormatters } from "@/lib/format";
import PersonConflictNotice from "@/components/portal/PersonConflictNotice";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useStatusQueryParam } from "@/hooks/useStatusQueryParam";
import { isDemotingAccountStatus } from "@/lib/accountStatus";

const STATUSES = ["prospect", "active", "inactive", "suspended"] as const;
const FILTER_STATUSES = ["pending", ...STATUSES] as const;
const PAGE_SIZE = 50;

export default function AdminClients() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.clients);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const affiliates = useAppSelector((s) => s.adminPortal.affiliates.items);
  const canWrite = useAdminCan("people.write");
  const canApprove = useAdminCan("approvals");
  const [q, setQ] = useState("");
  const [status, setStatus] = useStatusQueryParam(FILTER_STATUSES);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [invited, setInvited] = useState<number | null>(null);
  const rowBusy = useRowBusy();
  const [pendingDemote, setPendingDemote] = useState<PendingStatusChange | null>(
    null,
  );

  useEffect(() => {
    setOffset(0);
  }, [q, status]);

  const load = () =>
    void dispatch(
      fetchAdminClients({
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

  const applyClientStatus = async (id: number, next: string) => {
    await rowBusy.run(
      id,
      "status",
      async () => {
        const r = await dispatch(updateAdminClient({ id, patch: { status: next } }));
        return updateAdminClient.fulfilled.match(r);
      },
      { onFlashEnd: load },
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
    void applyClientStatus(id, to);
  };

  const approvePending = async (id: number) => {
    await rowBusy.run(
      id,
      "approve",
      async () => {
        const r = await dispatch(
          updateAdminClient({ id, patch: { status: "prospect" } }),
        );
        return updateAdminClient.fulfilled.match(r);
      },
      { flash: true, onFlashEnd: load },
    );
  };

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
  });

  type NewClient = {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_line1: string;
    city: string;
    zip: string;
    affiliate_id: string;
  };
  const lastClient = useRef<NewClient | null>(null);
  /** Create (or re-send with a staff shared-phone reason after a phone-only match). */
  const submitClient = async (v: NewClient, sharedPhoneReason?: string) => {
    lastClient.current = v;
    const { affiliate_id, ...rest } = v;
    const r = await dispatch(
      createAdminClient({
        ...rest,
        affiliate_id: affiliate_id ? Number(affiliate_id) : null,
        preferred_language: i18n.language?.startsWith("es") ? "es" : "en",
        ...(sharedPhoneReason ? { shared_phone_reason: sharedPhoneReason } : {}),
      }),
    );
    if (createAdminClient.fulfilled.match(r)) {
      setOpen(false);
      load();
    }
  };

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="portalNav.clients"
        leadKey="admin.clientsLead"
        actions={
          canWrite ? (
            <HeaderAction
              labelKey="admin.addClient"
              icon={UserPlus}
              onClick={() => {
                dispatch(clearAdminSaveError());
                void dispatch(fetchAdminAffiliates({ status: "active", limit: 100 }));
                setOpen(true);
              }}
            />
          ) : null
        }
      />
      <DuplicatesPanel entity="client" />
      <div className="pf-filters">
        <SearchBox onSearch={setQ} />
        <FilterSelect
          value={status}
          onChange={setStatus}
          ariaLabel={t("pf.status")}
          allLabel={t("admin.filterAllStatuses")}
          options={enumOptions(t, "accountStatus", FILTER_STATUSES)}
        />
      </div>
      <ErrorNote error={error} />
      {!open ? <ErrorNote error={saveError} /> : null}
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noClients"
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/admin/clients/${c.id}`)}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (c) => (
              <>
                <strong>{c.first_name} {c.last_name}</strong>{" "}
                <DealStatusBadge en={c.deal_status_en} es={c.deal_status_es} tone={c.deal_status_tone} />
                <br />
                <span className="pf-muted">{c.email}{c.phone ? ` · ${c.phone}` : ""}</span>
              </>
            ),
          },
          ...touchColumns(),
          { key: "address", headerKey: "pf.address", render: (c) => [c.address_line1, c.city].filter(Boolean).join(", ") || "—" },
          { key: "aff", headerKey: "admin.affiliate", render: (c) => c.affiliate_name || "—" },
          { key: "projects", headerKey: "portalNav.projects", render: (c) => c.project_count },
          { key: "date", headerKey: "pf.created", render: (c) => fmt.date(c.created_at) },
          {
            key: "status",
            headerKey: "pf.status",
            render: (c) =>
              c.status === "pending" || rowBusy.isDone(c.id, "approve") ? (
                <StatusBadge
                  group="accountStatus"
                  value={rowBusy.isDone(c.id, "approve") ? "prospect" : c.status}
                />
              ) : (
                <InlineSelect
                  ariaLabel={t("pf.status")}
                  value={c.status}
                  disabled={!canWrite || rowBusy.isRowLocked(c.id)}
                  options={enumOptions(t, "accountStatus", STATUSES)}
                  onChange={(v) =>
                    requestStatusChange(
                      c.id,
                      rowBusy.isDone(c.id, "approve") ? "prospect" : c.status,
                      v,
                      `${c.first_name} ${c.last_name}`.trim(),
                    )
                  }
                />
              ),
          },
          {
            key: "actions",
            headerKey: "pf.actions",
            className: "pf-col-actions",
            render: (c) => {
              const showApprove =
                rowBusy.isDone(c.id, "approve") ||
                (c.status === "pending" && canApprove);
              const showInvite =
                !showApprove &&
                canWrite &&
                c.status !== "pending";
              return (
                <div
                  className="pf-table-actions gw-people-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {c.phone ? (
                    <>
                      <Link
                        className="pf-btn pf-btn--sm pf-btn--nowrap"
                        to={`/admin/conversations?client=${c.id}`}
                      >
                        <MessageSquare size={14} aria-hidden />
                        {t("conversations.messageClient")}
                      </Link>
                      <Link
                        className="pf-btn pf-btn--sm pf-btn--nowrap"
                        to={`/admin/conversations?client=${c.id}&dial=1`}
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
                      busy={rowBusy.isBusy(c.id, "approve")}
                      done={rowBusy.isDone(c.id, "approve")}
                      onClick={() => void approvePending(c.id)}
                    />
                  ) : null}
                  {showInvite ? (
                    <BusyButton
                      className="pf-btn--nowrap pf-btn--sm"
                      icon={Mail}
                      stopPropagation
                      label={
                        invited === c.id || rowBusy.isDone(c.id, "invite")
                          ? t("admin.inviteSent")
                          : t("admin.portalInvite")
                      }
                      busyLabel={t("pf.busy.sendingPortalInvite")}
                      doneLabel={t("pf.done.inviteSent")}
                      busy={rowBusy.isBusy(c.id, "invite")}
                      done={rowBusy.isDone(c.id, "invite")}
                      disabled={
                        rowBusy.isRowLocked(c.id) &&
                        !rowBusy.isBusy(c.id, "invite") &&
                        !rowBusy.isDone(c.id, "invite")
                      }
                      onClick={() => {
                        void rowBusy.run(
                          c.id,
                          "invite",
                          async () => {
                            const r = await dispatch(sendClientPortalInvite(c.id));
                            return sendClientPortalInvite.fulfilled.match(r);
                          },
                          {
                            flash: true,
                            onFlashEnd: () => setInvited(c.id),
                          },
                        );
                      }}
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
          void applyClientStatus(id, to).then(() => setPendingDemote(null));
        }}
      />

      <Modal open={open} titleKey="admin.addClient" onClose={() => setOpen(false)}>
        <Formik
          initialValues={{ first_name: "", last_name: "", email: "", phone: "", address_line1: "", city: "", zip: "", affiliate_id: "" }}
          validationSchema={schema}
          onSubmit={(v) => submitClient(v)}
        >
          <Form className="pf-form">
            <ErrorNote error={saveError} />
            <PersonConflictNotice
              busy={saving}
              onOverride={(reason) => lastClient.current && void submitClient(lastClient.current, reason)}
            />
            <div className="pf-form-grid">
              <TextField name="first_name" labelKey="form.firstName" />
              <TextField name="last_name" labelKey="form.lastName" />
              <TextField name="email" labelKey="form.email" type="email" />
              <TextField name="phone" labelKey="form.phone" type="tel" />
            </div>
            <TextField name="address_line1" labelKey="form.address" />
            <div className="pf-form-grid">
              <TextField name="city" labelKey="pf.city" />
              <TextField name="zip" labelKey="pf.zip" />
            </div>
            <SelectField
              name="affiliate_id"
              labelKey="admin.affiliate"
              options={[
                { value: "", label: t("pf.none") },
                ...affiliates
                  .filter((a) => a.status === "active")
                  .map((a) => ({ value: a.id, label: `${a.first_name} ${a.last_name}` })),
              ]}
            />
            <SubmitButton busy={saving} labelKey="pf.create" />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
