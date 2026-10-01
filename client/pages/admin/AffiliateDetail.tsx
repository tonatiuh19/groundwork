import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminRecordDetail,
  clearAdminSaveError,
  fetchAdminAffiliateDetail,
  updateAdminAffiliate,
} from "@/store/slices/adminPortalSlice";
import {
  BackLink,
  CopyButton,
  ErrorNote,
  Loading,
  PageHeader,
  RecordHeadCard,
  SelectField,
  StatCard,
  SubmitButton,
  TextField,
  enumOptions,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const STATUSES = ["pending", "active", "inactive", "suspended"] as const;
const SLUG_RE = /^[a-z0-9-]{3,64}$/;

export default function AdminAffiliateDetail() {
  const { t } = useTranslation();
  const { id: rawId = "" } = useParams();
  const id = Number(rawId);
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.affiliateDetail);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const canWrite = useAdminCan("approvals");

  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminRecordDetail());
    if (!Number.isInteger(id) || id <= 0) return;
    void dispatch(fetchAdminAffiliateDetail(id));
  }, [dispatch, id]);

  const a = data?.id === id ? data : null;
  const trackingUrl = a
    ? `${window.location.origin}/r/${a.slug || a.referral_code}`
    : "";

  const schema = Yup.object({
    slug: Yup.string()
      .trim()
      .test("slug", t("validation.slugFormat"), (v) => !v || SLUG_RE.test(v)),
  });

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="admin.affiliateTitle"
        title={a ? `${a.first_name} ${a.last_name}` : undefined}
        leadKey="admin.affiliateDetailLead"
      />
      <BackLink to="/admin/affiliates" labelKey="admin.backToAffiliates" />
      <ErrorNote error={error} />
      {loading && !a ? <Loading /> : null}
      {a ? (
        <>
          <RecordHeadCard
            kicker={t("portalNav.affiliates")}
            title={`${a.first_name} ${a.last_name}`}
            subtitle={`${a.email}${a.phone ? ` · ${a.phone}` : ""}`}
            statusGroup="accountStatus"
            status={a.status}
            actions={<CopyButton value={trackingUrl} />}
          />

          {a.avatar_url || a.bio ? (
            <section className="pf-section pf-affiliate-public">
              <h2 className="pf-h2">{t("admin.affiliatePublicProfile")}</h2>
              <div className="pf-affiliate-public-inner">
                {a.avatar_url ? (
                  <img
                    className="pf-affiliate-public-avatar"
                    src={a.avatar_url}
                    alt=""
                  />
                ) : null}
                {a.bio ? <p className="pf-muted">{a.bio}</p> : null}
              </div>
            </section>
          ) : null}

          <div className="pf-stats">
            <StatCard
              labelKey="aff.codeLabel"
              value={<code>{a.referral_code}</code>}
              hint={trackingUrl}
            />
            <StatCard labelKey="aff.clicks" value={a.click_count} />
            <StatCard labelKey="aff.clients" value={a.client_count} />
            <StatCard labelKey="admin.approvedAt" value={fmt.date(a.approved_at)} />
            <StatCard labelKey="admin.lastLogin" value={fmt.date(a.last_login_at)} />
            <StatCard labelKey="pf.created" value={fmt.date(a.created_at)} />
          </div>

          <ErrorNote error={saveError} />

          <section className="pf-section">
            <h2 className="pf-h2">{t("admin.recordDetails")}</h2>
            <Formik
              enableReinitialize
              initialValues={{
                company: a.company || "",
                phone: a.phone || "",
                slug: a.slug || "",
                status: a.status as string,
                notes: a.notes || "",
              }}
              validationSchema={schema}
              onSubmit={async (v) => {
                const r = await dispatch(
                  updateAdminAffiliate({
                    id: a.id,
                    patch: {
                      company: v.company.trim() || null,
                      phone: v.phone.trim() || null,
                      slug: v.slug.trim() || null,
                      status: v.status,
                      notes: v.notes.trim() || null,
                    },
                  }),
                );
                if (updateAdminAffiliate.fulfilled.match(r)) {
                  void dispatch(fetchAdminAffiliateDetail(a.id));
                }
              }}
            >
              <Form className="pf-form pf-card">
                <div className="pf-form-grid">
                  <TextField name="company" labelKey="pf.company" disabled={!canWrite} />
                  <TextField name="phone" labelKey="form.phone" type="tel" disabled={!canWrite} />
                  <TextField name="slug" labelKey="admin.slug" disabled={!canWrite} />
                  <SelectField
                    name="status"
                    labelKey="pf.status"
                    options={enumOptions(t, "accountStatus", STATUSES)}
                    disabled={!canWrite}
                  />
                </div>
                <p className="pf-muted">{t("admin.slugHelp")}</p>
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
