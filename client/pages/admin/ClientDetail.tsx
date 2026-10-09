import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Check, Mail, MessageSquare, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminRecordDetail,
  clearAdminSaveError,
  fetchAdminAffiliates,
  fetchAdminAssignees,
  fetchAdminClientDetail,
  sendClientPortalInvite,
  updateAdminClient,
} from "@/store/slices/adminPortalSlice";
import {
  BackLink,
  BusyButton,
  ErrorNote,
  Loading,
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

const STATUSES = ["prospect", "active", "inactive", "suspended"] as const;
const idOrNull = (v: string) => (v ? Number(v) : null);

type ClientForm = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: string;
  address_line1: string;
  city: string;
  zip: string;
  affiliate_id: string;
  assigned_admin_id: string;
  preferred_language: string;
  admin_notes: string;
};

export default function AdminClientDetail() {
  const { t } = useTranslation();
  const { id: rawId = "" } = useParams();
  const id = Number(rawId);
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.clientDetail);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const affiliates = useAppSelector((s) => s.adminPortal.affiliates.items);
  const assignees = useAppSelector((s) => s.adminPortal.assignees.items);
  const canWrite = useAdminCan("people.write");
  const canApprove = useAdminCan("approvals");
  const [invited, setInvited] = useState(false);
  const [approved, setApproved] = useState(false);
  const inviteBusy = useBusyAction(900);
  const approveBusy = useBusyAction(900);
  const [pendingDemote, setPendingDemote] = useState<PendingStatusChange | null>(
    null,
  );
  const [pendingValues, setPendingValues] = useState<ClientForm | null>(null);
  const [demoteBusy, setDemoteBusy] = useState(false);

  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminRecordDetail());
    setInvited(false);
    setApproved(false);
    if (!Number.isInteger(id) || id <= 0) return;
    void dispatch(fetchAdminClientDetail(id));
    void dispatch(fetchAdminAffiliates({ limit: 100 }));
    void dispatch(fetchAdminAssignees());
  }, [dispatch, id]);

  const c = data?.id === id ? data : null;
  const isPending = c?.status === "pending";
  const currentStatus = approved ? "prospect" : c?.status || "";
  const canInvite =
    canWrite &&
    c &&
    (c.status === "prospect" || c.status === "active") &&
    !!c.email;

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string()
      .trim()
      .test(
        "email",
        t("validation.emailInvalid"),
        (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      ),
  });

  const lastClientForm = useRef<ClientForm | null>(null);
  const saveClient = async (v: ClientForm, sharedPhoneReason?: string) => {
    lastClientForm.current = v;
    if (!c) return false;
    const r = await dispatch(
      updateAdminClient({
        id: c.id,
        patch: {
          ...(sharedPhoneReason ? { shared_phone_reason: sharedPhoneReason } : {}),
          first_name: v.first_name.trim(),
          last_name: v.last_name.trim(),
          email: v.email.trim() || null,
          phone: v.phone.trim() || null,
          ...(isPending && !approved ? {} : { status: v.status }),
          address_line1: v.address_line1.trim() || null,
          city: v.city.trim() || null,
          zip: v.zip.trim() || null,
          affiliate_id: idOrNull(v.affiliate_id),
          assigned_admin_id: idOrNull(v.assigned_admin_id),
          preferred_language: v.preferred_language,
          admin_notes: v.admin_notes.trim() || null,
        },
      }),
    );
    if (updateAdminClient.fulfilled.match(r)) {
      void dispatch(fetchAdminClientDetail(c.id));
      return true;
    }
    return false;
  };

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="admin.clientTitle"
        title={c ? `${c.first_name} ${c.last_name}` : undefined}
        leadKey="admin.clientDetailLead"
      />
      <BackLink to="/admin/clients" labelKey="admin.backToClients" />
      <ErrorNote error={error} />
      {loading && !c ? <Loading /> : null}
      {c ? (
        <>
          <RecordHeadCard
            kicker={t("portalNav.clients")}
            title={`${c.first_name} ${c.last_name}`}
            subtitle={[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
            statusGroup="accountStatus"
            status={approved ? "prospect" : c.status}
            actions={
              <>
                {c.phone ? (
                  <>
                    <Link
                      className="pf-btn pf-btn--sm"
                      to={`/admin/conversations?client=${c.id}`}
                    >
                      <MessageSquare size={14} aria-hidden />
                      {t("conversations.messageClient")}
                    </Link>
                    <Link
                      className="pf-btn pf-btn--sm"
                      to={`/admin/conversations?client=${c.id}&dial=1`}
                    >
                      <Phone size={14} aria-hidden />
                      {t("conversations.callClient")}
                    </Link>
                  </>
                ) : null}
                {isPending && canApprove ? (
                  <BusyButton
                    tone="gold"
                    icon={Check}
                    label={t("admin.approve")}
                    busyLabel={t("pf.busy.approving")}
                    doneLabel={t("pf.done.approved")}
                    busy={approveBusy.busy}
                    done={approveBusy.done || approved}
                    disabled={!c.email}
                    title={!c.email ? t("validation.emailRequired") : undefined}
                    onClick={() => {
                      void approveBusy.run(
                        async () => {
                          const r = await dispatch(
                            updateAdminClient({
                              id: c.id,
                              patch: { status: "prospect" },
                            }),
                          );
                          return updateAdminClient.fulfilled.match(r);
                        },
                        {
                          flash: true,
                          onFlashEnd: () => {
                            setApproved(true);
                            void dispatch(fetchAdminClientDetail(c.id));
                          },
                        },
                      );
                    }}
                  />
                ) : null}
                {canInvite ? (
                  <BusyButton
                    icon={Mail}
                    label={invited || inviteBusy.done ? t("admin.inviteSent") : t("admin.portalInvite")}
                    busyLabel={t("pf.busy.sendingPortalInvite")}
                    doneLabel={t("pf.done.inviteSent")}
                    busy={inviteBusy.busy}
                    done={inviteBusy.done}
                    onClick={() => {
                      void inviteBusy.run(
                        async () => {
                          const r = await dispatch(sendClientPortalInvite(c.id));
                          return sendClientPortalInvite.fulfilled.match(r);
                        },
                        {
                          flash: true,
                          onFlashEnd: () => setInvited(true),
                        },
                      );
                    }}
                  />
                ) : null}
              </>
            }
          />

          <div className="pf-stats">
            <StatCard labelKey="portalNav.projects" value={c.project_count} />
            <StatCard labelKey="admin.affiliate" value={c.affiliate_name || "—"} />
            <StatCard labelKey="admin.lastLogin" value={fmt.date(c.last_login_at)} />
            <StatCard labelKey="pf.created" value={fmt.date(c.created_at)} />
          </div>

          <ErrorNote error={saveError} />
          <PersonConflictNotice
            busy={saving}
            onOverride={(reason) => lastClientForm.current && void saveClient(lastClientForm.current, reason)}
          />

          <section className="pf-section">
            <h2 className="pf-h2">{t("admin.recordDetails")}</h2>
            <Formik
              enableReinitialize
              initialValues={{
                first_name: c.first_name,
                last_name: c.last_name,
                email: c.email || "",
                phone: c.phone || "",
                status: (approved ? "prospect" : c.status) as string,
                address_line1: c.address_line1 || "",
                city: c.city || "",
                zip: c.zip || "",
                affiliate_id: c.affiliate_id ? String(c.affiliate_id) : "",
                assigned_admin_id: c.assigned_admin_id ? String(c.assigned_admin_id) : "",
                preferred_language: c.preferred_language || "en",
                admin_notes: c.admin_notes || "",
              }}
              validationSchema={schema}
              onSubmit={async (v) => {
                if (
                  !(isPending && !approved) &&
                  isDemotingAccountStatus(currentStatus, v.status)
                ) {
                  setPendingValues(v);
                  setPendingDemote({
                    id: c.id,
                    from: currentStatus,
                    to: v.status,
                    name: `${c.first_name} ${c.last_name}`.trim(),
                  });
                  return;
                }
                await saveClient(v);
              }}
            >
              <Form className="pf-form pf-card">
                <div className="pf-form-grid">
                  <TextField name="first_name" labelKey="form.firstName" disabled={!canWrite} />
                  <TextField name="last_name" labelKey="form.lastName" disabled={!canWrite} />
                  <TextField
                    name="email"
                    labelKey="form.email"
                    type="email"
                    disabled={!canWrite}
                  />
                  <TextField name="phone" labelKey="form.phone" type="tel" disabled={!canWrite} />
                  <SelectField
                    name="status"
                    labelKey="pf.status"
                    options={
                      isPending && !approved
                        ? [{ value: "pending", label: t("accountStatus.pending") }]
                        : enumOptions(t, "accountStatus", STATUSES)
                    }
                    disabled={!canWrite || (isPending && !approved)}
                  />
                </div>
                <p className="pf-muted">{t("admin.clientEmailHelp")}</p>
                {isPending && !approved ? (
                  <p className="pf-muted">{t("admin.pendingApprovalHelp")}</p>
                ) : null}
                <div className="pf-form-grid">
                  <TextField name="address_line1" labelKey="form.address" disabled={!canWrite} />
                  <TextField name="city" labelKey="pf.city" disabled={!canWrite} />
                  <TextField name="zip" labelKey="pf.zip" disabled={!canWrite} />
                </div>
                <div className="pf-form-grid">
                  <SelectField
                    name="affiliate_id"
                    labelKey="admin.affiliate"
                    disabled={!canWrite}
                    options={[
                      { value: "", label: t("pf.none") },
                      ...affiliates
                        .filter((a) => a.status === "active" || a.id === c.affiliate_id)
                        .map((a) => ({
                          value: a.id,
                          label: `${a.first_name} ${a.last_name}`,
                        })),
                    ]}
                  />
                  <SelectField
                    name="assigned_admin_id"
                    labelKey="admin.assignee"
                    disabled={!canWrite}
                    options={[
                      { value: "", label: t("pf.none") },
                      ...assignees.map((a) => ({
                        value: a.id,
                        label: `${a.first_name} ${a.last_name}`,
                      })),
                    ]}
                  />
                  <SelectField
                    name="preferred_language"
                    labelKey="admin.profileLanguage"
                    disabled={!canWrite}
                    options={[
                      { value: "en", label: t("lang.en") },
                      { value: "es", label: t("lang.es") },
                    ]}
                  />
                </div>
                <p className="pf-muted">{t("admin.affiliateLockHelp")}</p>
                <TextField
                  name="admin_notes"
                  labelKey="admin.internalNotes"
                  as="textarea"
                  rows={4}
                  disabled={!canWrite}
                />
                {canWrite ? <SubmitButton busy={saving} labelKey="pf.save" /> : null}
              </Form>
            </Formik>
          </section>

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
                  const ok = await saveClient(values);
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
