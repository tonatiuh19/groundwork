import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Formik, Form } from "formik";
import { Send } from "lucide-react";
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
  PageHeader,
  RecordHeadCard,
  SelectField,
  StatCard,
  SubmitButton,
  TextField,
  enumOptions,
  useBusyAction,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const STATUSES = ["active", "inactive", "suspended"] as const;

export default function AdminContractorDetail() {
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

  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminRecordDetail());
    if (!Number.isInteger(id) || id <= 0) return;
    void dispatch(fetchAdminContractorDetail(id));
  }, [dispatch, id]);

  const k = data?.id === id ? data : null;
  // The API rejects status changes while an invite is still outstanding.
  const statusLocked = k?.status === "invited";

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
            status={k.status}
            actions={
              statusLocked && canWrite ? (
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
              ) : null
            }
          />

          <div className="pf-stats">
            <StatCard labelKey="portalNav.projects" value={k.project_count} />
            <StatCard labelKey="admin.license" value={k.license_number || "—"} />
            <StatCard labelKey="admin.activatedAt" value={fmt.date(k.activated_at)} />
            <StatCard labelKey="admin.lastLogin" value={fmt.date(k.last_login_at)} />
            <StatCard labelKey="pf.created" value={fmt.date(k.created_at)} />
          </div>

          <ErrorNote error={saveError} />

          <section className="pf-section">
            <h2 className="pf-h2">{t("admin.recordDetails")}</h2>
            <Formik
              enableReinitialize
              initialValues={{
                company: k.company || "",
                phone: k.phone || "",
                license_number: k.license_number || "",
                status: k.status as string,
                notes: k.notes || "",
              }}
              onSubmit={async (v) => {
                const r = await dispatch(
                  updateAdminContractor({
                    id: k.id,
                    patch: {
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
                }
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
                      statusLocked
                        ? [{ value: "invited", label: t("accountStatus.invited") }]
                        : enumOptions(t, "accountStatus", STATUSES)
                    }
                    disabled={!canWrite || statusLocked}
                  />
                </div>
                {statusLocked ? <p className="pf-muted">{t("admin.invitePendingHelp")}</p> : null}
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
        </>
      ) : null}
    </div>
  );
}
