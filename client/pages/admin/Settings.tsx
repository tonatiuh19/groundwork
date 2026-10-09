import { useEffect, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { adminCan } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  fetchAdminSettings,
  saveAdminSettings,
} from "@/store/slices/adminPortalSlice";
import {
  ErrorNote,
  Loading,
  PageHeader,
  SubmitButton,
  TextField,
} from "@/components/portal/kit";
import { TeamNotificationsPanel } from "@/components/admin/TeamNotificationsPanel";
import { AdminPhoneNumbersPanel } from "@/components/admin/AdminPhoneNumbersPanel";
import { centsToDollars, dollarsToCents } from "@/lib/format";

export default function AdminSettings() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.settings);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const me = useAppSelector((s) => s.portalAuth.admin.user);
  const [saved, setSaved] = useState(false);

  const reload = () => void dispatch(fetchAdminSettings());
  useEffect(() => {
    dispatch(clearAdminSaveError());
    reload();
  }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const commissionSchema = Yup.object({
    days: Yup.number().min(0).required(t("validation.invalidField")),
    direct: Yup.string().required(t("validation.invalidField")),
    closer: Yup.string().required(t("validation.invalidField")),
    parent: Yup.string().required(t("validation.invalidField")),
  });

  const settings = data?.settings;
  const showPhonePanel =
    me?.role === "super_admin" || me?.role === "admin";
  const showTeamNotify = adminCan(me?.role, "settings");

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
              direct: centsToDollars(
                settings.commission_direct_cents_per_sqft ??
                  settings.commission_cents_per_sqft,
              ),
              closer: centsToDollars(settings.commission_closer_cents_per_sqft),
              parent: centsToDollars(settings.commission_parent_cents_per_sqft),
            }}
            validationSchema={commissionSchema}
            onSubmit={async (v) => {
              setSaved(false);
              const r = await dispatch(
                saveAdminSettings({
                  commission_payout_days_after_loan_close: Number(v.days),
                  commission_direct_cents_per_sqft: dollarsToCents(v.direct) ?? 0,
                  commission_closer_cents_per_sqft: dollarsToCents(v.closer) ?? 0,
                  commission_parent_cents_per_sqft: dollarsToCents(v.parent) ?? 0,
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
              <TextField name="direct" labelKey="admin.rateDirect" />
              <p className="pf-muted">{t("admin.rateDirectHelp")}</p>
              <TextField name="closer" labelKey="admin.rateCloser" />
              <p className="pf-muted">{t("admin.rateCloserHelp")}</p>
              <TextField name="parent" labelKey="admin.rateParent" />
              <p className="pf-muted">{t("admin.rateParentHelp")}</p>
              <SubmitButton busy={saving} labelKey="pf.save" />
              {saved ? <p className="pf-success-inline">{t("pf.saved")}</p> : null}
            </Form>
          </Formik>
        </section>
      ) : null}

      {showTeamNotify ? (
        <TeamNotificationsPanel className="pf-section" />
      ) : null}

      {showPhonePanel ? (
        <AdminPhoneNumbersPanel className="pf-section gw-phone-panel" />
      ) : null}
    </div>
  );
}
