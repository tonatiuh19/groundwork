import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { ClipboardCheck, ClipboardList, MessageSquare, Phone, Send, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import DuplicatesPanel from "@/components/admin/DuplicatesPanel";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  fetchAdminContractors,
  inviteContractor,
  updateAdminContractor,
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
import { useAdminCan } from "@/hooks/useAdminCan";
import { useStatusQueryParam } from "@/hooks/useStatusQueryParam";
import { isDemotingAccountStatus } from "@/lib/accountStatus";
import {
  conversationsComposeUrl,
  conversationsDialUrl,
} from "@/lib/conversationDeepLink";
import { CONTRACTOR_APPLICATION_STATUSES } from "@shared/contractorApplication";
import PrequalificationToolsModal from "@/components/contractorApplication/PrequalificationToolsModal";
import PersonConflictNotice from "@/components/portal/PersonConflictNotice";

const STATUSES = ["active", "inactive", "suspended"] as const;
const FILTER_STATUSES = ["pending", "invited", ...STATUSES] as const;
const PAGE_SIZE = 50;
const APP_FILTERS = ["none", ...CONTRACTOR_APPLICATION_STATUSES] as const;

export default function AdminContractors() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.contractors);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const canInvite = useAdminCan("approvals");
  const [q, setQ] = useState("");
  const [status, setStatus] = useStatusQueryParam(FILTER_STATUSES);
  const [offset, setOffset] = useState(0);
  const [appStatus, setAppStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const rowBusy = useRowBusy();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const [pendingDemote, setPendingDemote] = useState<PendingStatusChange | null>(
    null,
  );

  useEffect(() => {
    setOffset(0);
  }, [q, status, appStatus]);

  const load = () =>
    void dispatch(
      fetchAdminContractors({
        q: q || undefined,
        status: status || undefined,
        application_status: appStatus || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    );
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, [q, status, appStatus, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyStatus = async (id: number, next: string) => {
    await rowBusy.run(
      id,
      next === "active" ? "approve" : "status",
      async () => {
        const r = await dispatch(
          updateAdminContractor({ id, patch: { status: next } }),
        );
        return updateAdminContractor.fulfilled.match(r);
      },
      { flash: next === "active", onFlashEnd: load },
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
    void applyStatus(id, to);
  };

  type NewInvite = {
    first_name: string;
    last_name: string;
    email: string;
    company: string;
    license_number: string;
    phone: string;
  };
  const lastInvite = useRef<NewInvite | null>(null);
  /** Invite (or re-send with a staff shared-phone reason after a phone-only match). */
  const submitInvite = async (v: NewInvite, sharedPhoneReason?: string) => {
    lastInvite.current = v;
    const r = await dispatch(
      inviteContractor({
        ...v,
        email: v.email.trim(),
        first_name: v.first_name.trim(),
        last_name: v.last_name.trim(),
        company: v.company.trim() || null,
        license_number: v.license_number.trim() || null,
        phone: v.phone.trim() || null,
        preferred_language: lang,
        ...(sharedPhoneReason ? { shared_phone_reason: sharedPhoneReason } : {}),
      }),
    );
    if (inviteContractor.fulfilled.match(r)) {
      setOpen(false);
      load();
    }
  };

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
  });

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="portalNav.contractors"
        leadKey="admin.contractorsLead"
        actions={
          canInvite ? (
            <>
              <button type="button" className="pf-btn" onClick={() => setToolsOpen(true)}>
                <ClipboardList size={16} aria-hidden /> {t("cpq.tools.open")}
              </button>
              <HeaderAction
                labelKey="admin.inviteContractor"
                icon={UserPlus}
                onClick={() => {
                  dispatch(clearAdminSaveError());
                  setOpen(true);
                }}
              />
            </>
          ) : null
        }
      />
      <DuplicatesPanel entity="contractor" />
      <div className="pf-filters">
        <SearchBox onSearch={setQ} />
        <FilterSelect
          value={status}
          onChange={setStatus}
          ariaLabel={t("pf.status")}
          allLabel={t("admin.filterAllStatuses")}
          options={enumOptions(t, "accountStatus", FILTER_STATUSES)}
        />
        <FilterSelect
          value={appStatus}
          onChange={setAppStatus}
          ariaLabel={t("cpq.admin.colApplication")}
          allLabel={t("cpq.admin.filterAll")}
          options={enumOptions(t, "cpqStatus", APP_FILTERS)}
        />
      </div>
      <ErrorNote error={error} />
      {!open ? <ErrorNote error={saveError} /> : null}
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noContractors"
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/admin/contractors/${c.id}`)}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (c) => (
              <>
                <strong>{c.first_name} {c.last_name}</strong>
                <br />
                <span className="pf-muted">{c.email}</span>
              </>
            ),
          },
          { key: "company", headerKey: "pf.company", render: (c) => c.company || "—" },
          { key: "license", headerKey: "admin.license", render: (c) => c.license_number || "—" },
          { key: "projects", headerKey: "portalNav.projects", render: (c) => c.project_count },
          {
            key: "application",
            headerKey: "cpq.admin.colApplication",
            render: (c) => (
              <StatusBadge group="cpqStatus" value={c.application_status || "none"} />
            ),
          },
          { key: "date", headerKey: "pf.created", render: (c) => fmt.date(c.created_at) },
          {
            key: "status",
            headerKey: "pf.status",
            render: (c) =>
              c.status === "invited" ||
              c.status === "pending" ||
              rowBusy.isDone(c.id, "approve") ||
              !canInvite ? (
                <StatusBadge
                  group="accountStatus"
                  value={rowBusy.isDone(c.id, "approve") ? "active" : c.status}
                />
              ) : (
                <InlineSelect
                  ariaLabel={t("pf.status")}
                  value={c.status}
                  disabled={rowBusy.isRowLocked(c.id)}
                  options={enumOptions(t, "accountStatus", STATUSES)}
                  onChange={(v) =>
                    requestStatusChange(
                      c.id,
                      c.status,
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
              const name = `${c.first_name} ${c.last_name}`.trim();
              // Pending contractors are activated by approving their prequalification.
              const showReview =
                c.status === "pending" &&
                canInvite &&
                (c.application_status === "submitted" || c.application_status === "in_review");
              const showResend = c.status === "invited" && canInvite;
              return (
                <div
                  className="pf-table-actions gw-people-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {c.phone ? (
                    <>
                      <Link
                        className="pf-btn pf-btn--sm pf-btn--nowrap"
                        to={conversationsComposeUrl({
                          phone: c.phone,
                          name,
                        })}
                      >
                        <MessageSquare size={14} aria-hidden />
                        {t("conversations.messageClient")}
                      </Link>
                      <Link
                        className="pf-btn pf-btn--sm pf-btn--nowrap"
                        to={conversationsDialUrl({ phone: c.phone })}
                      >
                        <Phone size={14} aria-hidden />
                        {t("conversations.callClient")}
                      </Link>
                    </>
                  ) : null}
                  {showReview ? (
                    <Link
                      className="pf-btn pf-btn--gold pf-btn--sm pf-btn--nowrap"
                      to={`/admin/contractors/${c.id}#application`}
                    >
                      <ClipboardCheck size={14} aria-hidden />
                      {t("cpq.admin.review")}
                    </Link>
                  ) : null}
                  {showResend ? (
                    <BusyButton
                      className="pf-btn--nowrap pf-btn--sm"
                      icon={Send}
                      stopPropagation
                      label={t("admin.resendInvite")}
                      busyLabel={t("pf.busy.sendingInvite")}
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
                            const r = await dispatch(
                              inviteContractor({
                                email: c.email,
                                first_name: c.first_name,
                                last_name: c.last_name,
                                company: c.company,
                                license_number: c.license_number,
                                phone: c.phone,
                                preferred_language: lang,
                              }),
                            );
                            return inviteContractor.fulfilled.match(r);
                          },
                          { flash: true, onFlashEnd: load },
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

      <PrequalificationToolsModal open={toolsOpen} onClose={() => setToolsOpen(false)} onSent={load} />
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
          void applyStatus(id, to).then(() => setPendingDemote(null));
        }}
      />

      <Modal open={open} titleKey="admin.inviteContractor" onClose={() => setOpen(false)}>
        <Formik
          initialValues={{ first_name: "", last_name: "", email: "", company: "", license_number: "", phone: "" }}
          validationSchema={schema}
          onSubmit={(v) => submitInvite(v)}
        >
          <Form className="pf-form">
            <ErrorNote error={saveError} />
            <PersonConflictNotice
              busy={saving}
              onOverride={(reason) => lastInvite.current && void submitInvite(lastInvite.current, reason)}
            />
            <div className="pf-form-grid">
              <TextField name="first_name" labelKey="form.firstName" />
              <TextField name="last_name" labelKey="form.lastName" />
            </div>
            <TextField name="email" labelKey="form.email" type="email" />
            <div className="pf-form-grid">
              <TextField name="company" labelKey="pf.company" />
              <TextField name="license_number" labelKey="admin.license" />
            </div>
            <TextField name="phone" labelKey="form.phone" type="tel" />
            <SubmitButton busy={saving} labelKey="admin.sendInvite" />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
