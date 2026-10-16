import { useEffect, useState, useRef } from "react";
import LastContactStrip from "@/components/admin/LastContactStrip";
import DeletePersonButton from "@/components/admin/DeletePersonButton";
import { useNavigate, useParams } from "react-router-dom";
import { Formik, Form } from "formik";
import { Check, ClipboardCheck, Send, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminRecordDetail,
  clearAdminSaveError,
  fetchAdminContractorDetail,
  inviteContractor,
  updateAdminContractor,
} from "@/store/slices/adminPortalSlice";
import {
  BackLink,
  BusyButton,
  ErrorNote,
  Loading,
  Modal,
  PageHeader,
  RecordHeadCard,
  SelectField,
  StatCard,
  SubmitButton,
  TextField,
  enumOptions,
  useBusyAction,
} from "@/components/portal/kit";
import {
  ConfirmStatusChangeModal,
  type PendingStatusChange,
} from "@/components/portal/ConfirmStatusChangeModal";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";
import PersonConflictNotice from "@/components/portal/PersonConflictNotice";
import { isDemotingAccountStatus } from "@/lib/accountStatus";
import AdminApplicationPanel from "@/components/contractorApplication/AdminApplicationPanel";
import ContractorBillingAdmin from "@/components/admin/ContractorBillingAdmin";
import {
  clearCpqActionError,
  overrideActivateContractor,
} from "@/store/slices/adminContractorApplicationSlice";

const STATUSES = ["active", "inactive", "suspended"] as const;

type ContractorForm = {
  company: string;
  phone: string;
  license_number: string;
  status: string;
  notes: string;
};

export default function AdminContractorDetail() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { id: rawId = "" } = useParams();
  const id = Number(rawId);
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.contractorDetail);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const canWrite = useAdminCan("approvals");
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const inviteBusy = useBusyAction(900);
  const approveBusy = useBusyAction(900);
  const [approved, setApproved] = useState(false);
  const [pendingDemote, setPendingDemote] = useState<PendingStatusChange | null>(
    null,
  );
  const [pendingValues, setPendingValues] = useState<ContractorForm | null>(null);
  const [demoteBusy, setDemoteBusy] = useState(false);
  const isSuper = useAppSelector((s) => s.portalAuth.admin.user?.role === "super_admin");
  const { busy: cpqBusy, actionError: cpqError } = useAppSelector((s) => s.adminContractorApplication);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminRecordDetail());
    setApproved(false);
    if (!Number.isInteger(id) || id <= 0) return;
    void dispatch(fetchAdminContractorDetail(id));
  }, [dispatch, id]);

  const k = data?.id === id ? data : null;
  const isPending = k?.status === "pending";
  // The API rejects status changes while an invite is still outstanding.
  const statusLocked = k?.status === "invited" || (isPending && !approved);
  const currentStatus = approved ? "active" : k?.status || "";

  const lastContractorForm = useRef<ContractorForm | null>(null);
  const saveContractor = async (v: ContractorForm, sharedPhoneReason?: string) => {
    lastContractorForm.current = v;
    if (!k) return false;
    const r = await dispatch(
      updateAdminContractor({
        id: k.id,
        patch: {
          ...(sharedPhoneReason ? { shared_phone_reason: sharedPhoneReason } : {}),
          company: v.company.trim() || null,
          phone: v.phone.trim() || null,
          license_number: v.license_number.trim() || null,
          notes: v.notes.trim() || null,
          ...(statusLocked ? {} : { status: v.status }),
        },
      }),
    );
    if (updateAdminContractor.fulfilled.match(r)) {
      void dispatch(fetchAdminContractorDetail(k.id));
      return true;
    }
    return false;
  };

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="admin.contractorTitle"
        title={k ? k.company || `${k.first_name} ${k.last_name}` : undefined}
        leadKey="admin.contractorDetailLead"
      />
      <BackLink to="/admin/contractors" labelKey="admin.backToContractors" />
      <ErrorNote error={error} />
      {loading && !k ? <Loading /> : null}
      {k ? (
        <>
          <RecordHeadCard
            kicker={t("portalNav.contractors")}
            title={`${k.first_name} ${k.last_name}`}
            subtitle={`${k.email}${k.phone ? ` · ${k.phone}` : ""}`}
            statusGroup="accountStatus"
            status={approved ? "active" : k.status}
            actions={
              <>
                {isPending && canWrite && k.application_status === "approved" ? (
                  <BusyButton
                    tone="gold"
                    icon={Check}
                    label={t("admin.approve")}
                    busyLabel={t("pf.busy.approving")}
                    doneLabel={t("pf.done.approved")}
                    busy={approveBusy.busy}
                    done={approveBusy.done || approved}
                    onClick={() => {
                      void approveBusy.run(
                        async () => {
                          const r = await dispatch(
                            updateAdminContractor({
                              id: k.id,
                              patch: { status: "active" },
                            }),
                          );
                          return updateAdminContractor.fulfilled.match(r);
                        },
                        {
                          flash: true,
                          onFlashEnd: () => {
                            setApproved(true);
                            void dispatch(fetchAdminContractorDetail(k.id));
                          },
                        },
                      );
                    }}
                  />
                ) : null}
                {isPending && canWrite && k.application_status !== "approved" && !approved ? (
                  <>
                    {/* Activation happens by approving the prequalification below. */}
                    <a className="pf-btn pf-btn--gold" href="#application">
                      <ClipboardCheck size={15} aria-hidden /> {t("cpq.admin.review")}
                    </a>
                    {isSuper ? (
                      <BusyButton
                        icon={ShieldAlert}
                        label={t("cpq.admin.override")}
                        onClick={() => {
                          dispatch(clearCpqActionError());
                          setOverrideReason("");
                          setOverrideOpen(true);
                        }}
                      />
                    ) : null}
                  </>
                ) : null}
                {k.status === "invited" && canWrite ? (
                  <BusyButton
                    icon={Send}
                    label={t("admin.resendInvite")}
                    busyLabel={t("pf.busy.sendingInvite")}
                    doneLabel={t("pf.done.inviteSent")}
                    busy={inviteBusy.busy}
                    done={inviteBusy.done}
                    onClick={() => {
                      void inviteBusy.run(
                        async () => {
                          const r = await dispatch(
                            inviteContractor({
                              email: k.email,
                              first_name: k.first_name,
                              last_name: k.last_name,
                              company: k.company,
                              license_number: k.license_number,
                              phone: k.phone,
                              preferred_language: lang,
                            }),
                          );
                          return inviteContractor.fulfilled.match(r);
                        },
                        {
                          flash: true,
                          onFlashEnd: () => {
                            void dispatch(fetchAdminContractorDetail(k.id));
                          },
                        },
                      );
                    }}
                  />
                ) : null}
              </>
            }
          />
          <LastContactStrip phone={k.phone} name={`${k.first_name} ${k.last_name}`.trim()} />

          <div className="pf-stats">
            <StatCard labelKey="portalNav.projects" value={k.project_count} />
            <StatCard labelKey="admin.license" value={k.license_number || "—"} />
            <StatCard labelKey="admin.activatedAt" value={fmt.date(k.activated_at)} />
            <StatCard labelKey="admin.lastLogin" value={fmt.date(k.last_login_at)} />
            <StatCard labelKey="pf.created" value={fmt.date(k.created_at)} />
          </div>

          <ErrorNote error={saveError} />
          <PersonConflictNotice
            busy={saving}
            onOverride={(reason) => lastContractorForm.current && void saveContractor(lastContractorForm.current, reason)}
          />

          <section className="pf-section">
            <h2 className="pf-h2">{t("admin.recordDetails")}</h2>
            <Formik
              enableReinitialize
              initialValues={{
                company: k.company || "",
                phone: k.phone || "",
                license_number: k.license_number || "",
                status: (approved ? "active" : k.status) as string,
                notes: k.notes || "",
              }}
              onSubmit={async (v) => {
                if (
                  !statusLocked &&
                  isDemotingAccountStatus(currentStatus, v.status)
                ) {
                  setPendingValues(v);
                  setPendingDemote({
                    id: k.id,
                    from: currentStatus,
                    to: v.status,
                    name: `${k.first_name} ${k.last_name}`.trim(),
                  });
                  return;
                }
                await saveContractor(v);
              }}
            >
              <Form className="pf-form pf-card">
                <div className="pf-form-grid">
                  <TextField name="company" labelKey="pf.company" disabled={!canWrite} />
                  <TextField name="phone" labelKey="form.phone" type="tel" disabled={!canWrite} />
                  <TextField
                    name="license_number"
                    labelKey="admin.license"
                    disabled={!canWrite}
                  />
                  <SelectField
                    name="status"
                    labelKey="pf.status"
                    options={
                      k.status === "invited"
                        ? [{ value: "invited", label: t("accountStatus.invited") }]
                        : isPending && !approved
                          ? [{ value: "pending", label: t("accountStatus.pending") }]
                          : enumOptions(t, "accountStatus", STATUSES)
                    }
                    disabled={!canWrite || statusLocked}
                  />
                </div>
                {k.status === "invited" ? (
                  <p className="pf-muted">{t("admin.invitePendingHelp")}</p>
                ) : null}
                {isPending && !approved ? (
                  <p className="pf-muted">{t("cpq.admin.pendingHelp")}</p>
                ) : null}
                <TextField
                  name="notes"
                  labelKey="admin.internalNotes"
                  as="textarea"
                  rows={4}
                  disabled={!canWrite}
                />
                {canWrite ? <SubmitButton busy={saving} labelKey="pf.save" /> : null}
              </Form>
            </Formik>
          </section>

          <AdminApplicationPanel
            contractorId={k.id}
            onContractorChanged={() => void dispatch(fetchAdminContractorDetail(k.id))}
          />

          <ContractorBillingAdmin contractorId={k.id} canWrite={canWrite} refreshKey={String(k.status)} />

          <section className="pf-section gw-danger-zone">
            <div>
              <h2 className="pf-h2">{t("erase.zoneTitle")}</h2>
              <p className="pf-hint">{t("erase.zoneLead.contractor")}</p>
            </div>
            <DeletePersonButton
              entity="contractor"
              id={k.id}
              name={`${k.first_name} ${k.last_name}`.trim()}
              onDeleted={() => navigate("/admin/contractors", { replace: true })}
            />
          </section>

          <Modal open={overrideOpen} titleKey="cpq.admin.overrideTitle" onClose={() => setOverrideOpen(false)}>
            <div className="pf-form">
              <p className="pf-muted">{t("cpq.admin.overrideBody")}</p>
              <label className="pf-field">
                <span>{t("cpq.admin.overrideReason")}</span>
                <textarea rows={3} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              </label>
              <ErrorNote error={cpqError} />
              <BusyButton
                tone="gold"
                icon={ShieldAlert}
                label={t("cpq.admin.overrideConfirm")}
                busy={cpqBusy === "override"}
                disabled={overrideReason.trim().length < 5}
                onClick={async () => {
                  const r = await dispatch(
                    overrideActivateContractor({ id: k.id, override_reason: overrideReason.trim() }),
                  );
                  if (overrideActivateContractor.fulfilled.match(r)) {
                    setOverrideOpen(false);
                    setApproved(true);
                    void dispatch(fetchAdminContractorDetail(k.id));
                  }
                }}
              />
            </div>
          </Modal>

          <ConfirmStatusChangeModal
            pending={pendingDemote}
            busy={demoteBusy || saving}
            onCancel={() => {
              if (demoteBusy) return;
              setPendingDemote(null);
              setPendingValues(null);
            }}
            onConfirm={() => {
              if (!pendingValues) return;
              const values = pendingValues;
              void (async () => {
                setDemoteBusy(true);
                try {
                  const ok = await saveContractor(values);
                  if (ok) {
                    setPendingDemote(null);
                    setPendingValues(null);
                  }
                } finally {
                  setDemoteBusy(false);
                }
              })();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
