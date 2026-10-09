import { useEffect, useState, useRef } from "react";
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
  ErrorNote,
  Loading,
  PageHeader,
  RecordHeadCard,
  SelectField,
  StatCard,
  SubmitButton,
  TextField,
  TrackingLinkChip,
  enumOptions,
} from "@/components/portal/kit";
import {
  ConfirmStatusChangeModal,
  type PendingStatusChange,
} from "@/components/portal/ConfirmStatusChangeModal";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";
import PersonConflictNotice from "@/components/portal/PersonConflictNotice";
import { isDemotingAccountStatus } from "@/lib/accountStatus";
import { slugifyAffiliate } from "@/lib/affiliateSlug";
import { yupAffiliateSlug } from "@/lib/validation";

const STATUSES = ["pending", "active", "inactive", "suspended"] as const;

type AffForm = {
  company: string;
  phone: string;
  slug: string;
  status: string;
  notes: string;
};

export default function AdminAffiliateDetail() {
  const { t } = useTranslation();
  const { id: rawId = "" } = useParams();
  const id = Number(rawId);
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.affiliateDetail);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const canWrite = useAdminCan("approvals");
  const [pendingDemote, setPendingDemote] = useState<PendingStatusChange | null>(
    null,
  );
  const [pendingValues, setPendingValues] = useState<AffForm | null>(null);
  const [demoteBusy, setDemoteBusy] = useState(false);

  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminRecordDetail());
    if (!Number.isInteger(id) || id <= 0) return;
    void dispatch(fetchAdminAffiliateDetail(id));
  }, [dispatch, id]);

  const a = data?.id === id ? data : null;

  const schema = Yup.object({
    slug: yupAffiliateSlug(t("validation.slugFormat"), t("validation.slugReserved")),
  });

  const lastAffForm = useRef<AffForm | null>(null);
  const saveAffiliate = async (v: AffForm, sharedPhoneReason?: string) => {
    lastAffForm.current = v;
    if (!a) return false;
    const r = await dispatch(
      updateAdminAffiliate({
        id: a.id,
        patch: {
          ...(sharedPhoneReason ? { shared_phone_reason: sharedPhoneReason } : {}),
          company: v.company.trim() || null,
          phone: v.phone.trim() || null,
          slug: v.slug.trim() ? slugifyAffiliate(v.slug.trim()) : null,
          status: v.status,
          notes: v.notes.trim() || null,
        },
      }),
    );
    if (updateAdminAffiliate.fulfilled.match(r)) {
      void dispatch(fetchAdminAffiliateDetail(a.id));
      return true;
    }
    return false;
  };

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
            actions={
              <TrackingLinkChip slug={a.slug} referralCode={a.referral_code} />
            }
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
              labelKey="admin.trackingLinkCol"
              value={
                <TrackingLinkChip slug={a.slug} referralCode={a.referral_code} />
              }
            />
            <StatCard labelKey="aff.clicks" value={a.click_count} />
            <StatCard labelKey="aff.clients" value={a.client_count} />
            <StatCard
              labelKey="admin.parentAffiliate"
              value={a.parent_name || t("admin.topLevelAffiliate")}
            />
            <StatCard labelKey="admin.subCount" value={a.sub_count ?? 0} />
            <StatCard labelKey="admin.approvedAt" value={fmt.date(a.approved_at)} />
            <StatCard labelKey="admin.lastLogin" value={fmt.date(a.last_login_at)} />
            <StatCard labelKey="pf.created" value={fmt.date(a.created_at)} />
          </div>

          <ErrorNote error={saveError} />
          <PersonConflictNotice
            busy={saving}
            onOverride={(reason) => lastAffForm.current && void saveAffiliate(lastAffForm.current, reason)}
          />

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
                if (isDemotingAccountStatus(a.status, v.status)) {
                  setPendingValues(v);
                  setPendingDemote({
                    id: a.id,
                    from: a.status,
                    to: v.status,
                    name: `${a.first_name} ${a.last_name}`.trim(),
                  });
                  return;
                }
                await saveAffiliate(v);
              }}
            >
              <Form className="pf-form pf-card">
                <div className="pf-form-grid">
                  <TextField name="company" labelKey="pf.company" disabled={!canWrite} />
                  <TextField name="phone" labelKey="form.phone" type="tel" disabled={!canWrite} />
                  <TextField
                    name="slug"
                    labelKey="admin.slug"
                    disabled={!canWrite}
                    placeholder={t("admin.slugPlaceholder")}
                  />
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
                  const ok = await saveAffiliate(values);
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
