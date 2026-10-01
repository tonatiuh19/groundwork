import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Mail } from "lucide-react";
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
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const STATUSES = ["prospect", "active", "inactive", "suspended"] as const;
const idOrNull = (v: string) => (v ? Number(v) : null);

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
  const [invited, setInvited] = useState(false);
  const inviteBusy = useBusyAction(900);

  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminRecordDetail());
    setInvited(false);
    if (!Number.isInteger(id) || id <= 0) return;
    void dispatch(fetchAdminClientDetail(id));
    void dispatch(fetchAdminAffiliates({ limit: 100 }));
    void dispatch(fetchAdminAssignees());
  }, [dispatch, id]);

  const c = data?.id === id ? data : null;

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
  });

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
            subtitle={`${c.email}${c.phone ? ` · ${c.phone}` : ""}`}
            statusGroup="accountStatus"
            status={c.status}
            actions={
              canWrite ? (
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
              ) : null
            }
          />

          <div className="pf-stats">
            <StatCard labelKey="portalNav.projects" value={c.project_count} />
            <StatCard labelKey="admin.affiliate" value={c.affiliate_name || "—"} />
            <StatCard labelKey="admin.lastLogin" value={fmt.date(c.last_login_at)} />
            <StatCard labelKey="pf.created" value={fmt.date(c.created_at)} />
          </div>

          <ErrorNote error={saveError} />

          <section className="pf-section">
            <h2 className="pf-h2">{t("admin.recordDetails")}</h2>
            <Formik
              enableReinitialize
              initialValues={{
                first_name: c.first_name,
                last_name: c.last_name,
                phone: c.phone || "",
                status: c.status as string,
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
                const r = await dispatch(
                  updateAdminClient({
                    id: c.id,
                    patch: {
                      first_name: v.first_name.trim(),
                      last_name: v.last_name.trim(),
                      phone: v.phone.trim() || null,
                      status: v.status,
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
                }
              }}
            >
              <Form className="pf-form pf-card">
                <div className="pf-form-grid">
                  <TextField name="first_name" labelKey="form.firstName" disabled={!canWrite} />
                  <TextField name="last_name" labelKey="form.lastName" disabled={!canWrite} />
                  <TextField name="phone" labelKey="form.phone" type="tel" disabled={!canWrite} />
                  <SelectField
                    name="status"
                    labelKey="pf.status"
                    options={enumOptions(t, "accountStatus", STATUSES)}
                    disabled={!canWrite}
                  />
                </div>
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
        </>
      ) : null}
    </div>
  );
}
