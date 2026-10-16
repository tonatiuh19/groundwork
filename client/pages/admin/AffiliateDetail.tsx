import { useEffect, useState, useRef } from "react";
import LastContactStrip from "@/components/admin/LastContactStrip";
import DeletePersonButton from "@/components/admin/DeletePersonButton";
import { useNavigate, useParams } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { Handshake, MailWarning, PencilLine } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminRecordDetail,
  clearAdminSaveError,
  fetchAdminAffiliateDetail,
  fetchAdminAffiliates,
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
import AffiliateOnboardingPanel from "@/components/admin/AffiliateOnboardingPanel";
import AffiliateBillingAdminPanel from "@/components/admin/AffiliateBillingAdminPanel";
import { DetailList, SideDrawer } from "@/components/portal/SideDrawer";
import { isDemotingAccountStatus } from "@/lib/accountStatus";
import { slugifyAffiliate } from "@/lib/affiliateSlug";
import { yupAffiliateSlug } from "@/lib/validation";

const STATUSES = ["pending", "active", "inactive", "suspended"] as const;

type AffForm = {
  first_name: string;
  last_name: string;
  email: string;
  preferred_language: string;
  company: string;
  phone: string;
  slug: string;
  status: string;
  notes: string;
  /** Sponsor (Agreement §4); "" = none. */
  parent: string;
};

export default function AdminAffiliateDetail() {
  const navigate = useNavigate();
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
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminRecordDetail());
    if (!Number.isInteger(id) || id <= 0) return;
    void dispatch(fetchAdminAffiliateDetail(id));
  }, [dispatch, id]);

  const a = data?.id === id ? data : null;
  const sponsors = useAppSelector((s) => s.adminPortal.affiliates.items);
  useEffect(() => {
    void dispatch(fetchAdminAffiliates({ status: "active", limit: 100 }));
  }, [dispatch]);

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
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
          first_name: v.first_name.trim(),
          last_name: v.last_name.trim(),
          // Email only when it changed (it's the sign-in identity; changes notify both addresses).
          ...(a.email.trim().toLowerCase() !== v.email.trim().toLowerCase() ? { email: v.email.trim() } : {}),
          preferred_language: v.preferred_language,
          company: v.company.trim() || null,
          phone: v.phone.trim() || null,
          slug: v.slug.trim() ? slugifyAffiliate(v.slug.trim()) : null,
          status: v.status,
          notes: v.notes.trim() || null,
          parent_affiliate_id: v.parent ? Number(v.parent) : null,
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
          <LastContactStrip phone={a.phone} name={`${a.first_name} ${a.last_name}`.trim()} />

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
            <div className="gw-details-head">
              <h2 className="pf-h2">{t("admin.recordDetails")}</h2>
              {canWrite ? (
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => setEditOpen(true)}>
                  <PencilLine size={14} aria-hidden /> {t("editPanel.edit")}
                </button>
              ) : null}
            </div>
            <DetailList
              items={[
                { label: t("form.email"), value: a.email },
                { label: t("form.phone"), value: a.phone },
                { label: t("pf.company"), value: a.company },
                { label: t("admin.profileLanguage"), value: t(`lang.${a.preferred_language || "en"}`) },
                { label: t("admin.slug"), value: a.slug },
                { label: t("admin.affiliateSponsor"), value: a.parent_name || t("admin.affiliateSponsorNone") },
                { label: t("admin.internalNotes"), value: a.notes, wide: true },
              ]}
            />
          </section>

          <SideDrawer
            open={editOpen}
            onClose={() => setEditOpen(false)}
            busy={saving}
            icon={<Handshake size={18} />}
            title={t("editPanel.affiliateTitle")}
            subtitle={`${a.first_name} ${a.last_name}`}
            footer={
              <div className="pf-actions gw-drawer__foot-row">
                <DeletePersonButton
                  entity="affiliate"
                  id={a.id}
                  name={`${a.first_name} ${a.last_name}`.trim()}
                  onDeleted={() => navigate("/admin/affiliates", { replace: true })}
                />
                <span className="gw-flex-spacer" aria-hidden />
                <button type="button" className="pf-btn" onClick={() => setEditOpen(false)} disabled={saving}>
                  {t("pf.cancel")}
                </button>
                {canWrite ? <SubmitButton busy={saving} labelKey="pf.save" form="affiliate-edit-form" /> : null}
              </div>
            }
          >
            <ErrorNote error={saveError} />
            <PersonConflictNotice
              busy={saving}
              onOverride={(reason) =>
                lastAffForm.current &&
                void saveAffiliate(lastAffForm.current, reason).then((ok) => ok && setEditOpen(false))
              }
            />
            <Formik
              enableReinitialize
              initialValues={{
                first_name: a.first_name,
                last_name: a.last_name,
                email: a.email,
                preferred_language: a.preferred_language || "en",
                company: a.company || "",
                phone: a.phone || "",
                slug: a.slug || "",
                status: a.status as string,
                notes: a.notes || "",
                parent: a.parent_affiliate_id ? String(a.parent_affiliate_id) : "",
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
                if (await saveAffiliate(v)) setEditOpen(false);
              }}
            >
              {({ values }) => (
                <Form className="pf-form pf-card" id="affiliate-edit-form">
                  <section className="gw-drawer-section">
                    <h3 className="gw-drawer-section__title">{t("editPanel.contact")}</h3>
                    <div className="pf-form-grid">
                      <TextField name="first_name" labelKey="form.firstName" disabled={!canWrite} />
                      <TextField name="last_name" labelKey="form.lastName" disabled={!canWrite} />
                    </div>
                    <TextField name="email" labelKey="form.email" type="email" disabled={!canWrite} />
                    {values.email.trim().toLowerCase() !== a.email.toLowerCase() ? (
                      <p className="gw-drawer-email-note" role="status">
                        <MailWarning size={15} aria-hidden /> {t("editPanel.emailChangeNote")}
                      </p>
                    ) : null}
                    <div className="pf-form-grid">
                      <TextField name="phone" labelKey="form.phone" type="tel" disabled={!canWrite} />
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
                    <TextField name="company" labelKey="pf.company" disabled={!canWrite} />
                  </section>
                  <section className="gw-drawer-section">
                    <h3 className="gw-drawer-section__title">{t("editPanel.program")}</h3>
                    <TextField name="slug" labelKey="admin.slug" disabled={!canWrite} placeholder={t("admin.slugPlaceholder")} />
                    <p className="pf-muted">{t("admin.slugHelp")}</p>
                    <SelectField
                      name="parent"
                      labelKey="admin.affiliateSponsor"
                      disabled={!canWrite}
                      options={[
                        { value: "", label: t("admin.affiliateSponsorNone") },
                        // Keep the current sponsor selectable even if inactive / beyond the first page.
                        ...(a.parent_affiliate_id && !sponsors.some((x) => x.id === a.parent_affiliate_id)
                          ? [{ value: String(a.parent_affiliate_id), label: a.parent_name || `#${a.parent_affiliate_id}` }]
                          : []),
                        ...sponsors
                          .filter((x) => x.id !== a.id)
                          .map((x) => ({ value: String(x.id), label: `${x.first_name} ${x.last_name} · ${x.email}` })),
                      ]}
                    />
                    <p className="pf-muted">{t("admin.affiliateSponsorHelp")}</p>
                  </section>
                  <section className="gw-drawer-section">
                    <h3 className="gw-drawer-section__title">{t("editPanel.account")}</h3>
                    <SelectField
                      name="status"
                      labelKey="pf.status"
                      options={enumOptions(t, "accountStatus", STATUSES)}
                      disabled={!canWrite}
                    />
                    <TextField name="notes" labelKey="admin.internalNotes" as="textarea" rows={5} disabled={!canWrite} />
                  </section>
                </Form>
              )}
            </Formik>
          </SideDrawer>

          <AffiliateOnboardingPanel affiliateId={a.id} />
          <AffiliateBillingAdminPanel affiliateId={a.id} />

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
                    setEditOpen(false);
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
