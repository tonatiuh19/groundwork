import { useEffect, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  createNotifyExtra,
  deleteNotifyExtra,
  fetchAdminSettings,
  saveAdminSettings,
  updateNotifyExtra,
} from "@/store/slices/adminPortalSlice";
import { ErrorNote, Loading, PageHeader, SubmitButton, TextField, BusyButton, useRowBusy } from "@/components/portal/kit";
import { centsToDollars, dollarsToCents } from "@/lib/format";

export default function AdminSettings() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.settings);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const [saved, setSaved] = useState(false);
  const rowBusy = useRowBusy();

  const reload = () => void dispatch(fetchAdminSettings());

  useEffect(() => {
    dispatch(clearAdminSaveError());
    reload();
  }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const commissionSchema = Yup.object({
    days: Yup.number().integer().min(0).max(365).required(t("validation.invalidField")),
    rate: Yup.string().required(t("validation.invalidField")),
  });

  const extraSchema = Yup.object({
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .required(t("validation.emailRequired")),
    label: Yup.string().trim(),
  });

  const settings = data?.settings;
  const extras = data?.notify_extra_emails || [];

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.settings" leadKey="admin.settingsLead" />
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : null}
      {settings ? (
        <section className="pf-card pf-card--narrow">
          <Formik
            enableReinitialize
            initialValues={{
              days: settings.commission_payout_days_after_loan_close,
              rate: centsToDollars(settings.commission_cents_per_sqft),
            }}
            validationSchema={commissionSchema}
            onSubmit={async (v) => {
              setSaved(false);
              const r = await dispatch(
                saveAdminSettings({
                  commission_payout_days_after_loan_close: Number(v.days),
                  commission_cents_per_sqft: dollarsToCents(v.rate) ?? 0,
                }),
              );
              if (saveAdminSettings.fulfilled.match(r)) {
                setSaved(true);
                reload();
              }
            }}
          >
            <Form className="pf-form">
              <ErrorNote error={saveError} />
              <h3>{t("admin.commissionRules")}</h3>
              <TextField name="days" labelKey="admin.payoutDays" type="number" />
              <p className="pf-muted">{t("admin.payoutDaysHelp")}</p>
              <TextField name="rate" labelKey="admin.ratePerSqft" />
              <p className="pf-muted">{t("admin.ratePerSqftHelp")}</p>
              <SubmitButton busy={saving} labelKey="pf.save" />
              {saved ? <p className="pf-success-inline">{t("pf.saved")}</p> : null}
            </Form>
          </Formik>
        </section>
      ) : null}

      {data ? (
        <section className="pf-card pf-card--narrow pf-section">
          <h3>{t("admin.notifyExtrasTitle")}</h3>
          <p className="pf-muted">{t("admin.notifyExtrasLead")}</p>
          {extras.length === 0 ? (
            <p className="pf-muted">{t("admin.noNotifyExtras")}</p>
          ) : (
            <ul className="pf-notify-list">
              {extras.map((extra) => (
                <li key={extra.id} className="pf-notify-row">
                  <div>
                    <strong>{extra.email}</strong>
                    {extra.label ? (
                      <>
                        <br />
                        <span className="pf-muted">{extra.label}</span>
                      </>
                    ) : null}
                  </div>
                  <label className="pf-check-inline">
                    <input
                      type="checkbox"
                      checked={extra.is_active}
                      disabled={saving || rowBusy.isRowLocked(extra.id)}
                      onChange={(e) => {
                        const next = e.target.checked;
                        void rowBusy.run(
                          extra.id,
                          "toggle",
                          async () => {
                            const r = await dispatch(
                              updateNotifyExtra({
                                id: extra.id,
                                patch: { is_active: next },
                              }),
                            );
                            return updateNotifyExtra.fulfilled.match(r);
                          },
                          { onFlashEnd: reload },
                        );
                      }}
                    />
                    {t("admin.notifyExtraActive")}
                  </label>
                  <BusyButton
                    icon={Trash2}
                    label={t("admin.notifyExtraDelete")}
                    busyLabel={t("pf.busy.removing")}
                    doneLabel={t("pf.done.removed")}
                    busy={rowBusy.isBusy(extra.id, "delete")}
                    done={rowBusy.isDone(extra.id, "delete")}
                    disabled={
                      saving ||
                      (rowBusy.isRowLocked(extra.id) &&
                        !rowBusy.isBusy(extra.id, "delete") &&
                        !rowBusy.isDone(extra.id, "delete"))
                    }
                    onClick={() => {
                      void rowBusy.run(
                        extra.id,
                        "delete",
                        async () => {
                          const r = await dispatch(deleteNotifyExtra(extra.id));
                          return deleteNotifyExtra.fulfilled.match(r);
                        },
                        { flash: true, onFlashEnd: reload },
                      );
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <Formik
            initialValues={{ email: "", label: "" }}
            validationSchema={extraSchema}
            onSubmit={async (v, { resetForm }) => {
              const r = await dispatch(
                createNotifyExtra({
                  email: v.email.trim(),
                  label: v.label.trim() || null,
                }),
              );
              if (createNotifyExtra.fulfilled.match(r)) {
                resetForm();
                reload();
              }
            }}
          >
            <Form className="pf-form">
              <ErrorNote error={saveError} />
              <div className="pf-form-grid">
                <TextField name="email" labelKey="form.email" type="email" />
                <TextField name="label" labelKey="admin.notifyExtraLabel" />
              </div>
              <SubmitButton busy={saving} labelKey="admin.notifyExtrasAdd" />
            </Form>
          </Formik>
        </section>
      ) : null}
    </div>
  );
}
