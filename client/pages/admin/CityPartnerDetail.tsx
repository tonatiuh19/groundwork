import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BadgeCheck, Eye, FileSignature, FileText, MapPin, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearInvitePreview, countersignCityAgreement, fetchCityPartner, previewCityInvite, resendCityPartnerInvite, reviewCityW9, updateCityFee, updateCityPartner } from "@/store/slices/cityPartnerSlice";
import { fetchAdminCities } from "@/store/slices/citiesSlice";
import { BackLink, BusyButton, ErrorNote, PageHeader } from "@/components/portal/kit";
import { KitSkeleton } from "@/components/partnerKit/PartnerKit";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import DangerConfirmModal from "@/components/portal/DangerConfirmModal";
import EmailPreviewModal from "@/components/portal/EmailPreviewModal";
import type { CityPartnerDetail as CityPartnerDetailData } from "@shared/api";
import CityCreateModal from "@/components/admin/CityCreateModal";
import { centsToMoney } from "@/components/city/CityBits";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";

/** Rates are stored in cents; history shows them as dollars. */
const showValue = (field: string, v: string | null) => {
  if (v == null) return null;
  const m = /^(?:rate )?(\d+)$/.exec(v);
  return m && (field === "fee_cents_per_sqft" || field === "invited" || field === "signed") ? `${centsToMoney(Number(m[1]))}/sq ft` : v;
};

/**
 * Rate and LLC name: both are printed in the agreement, so they're editable only until the partner signs.
 * After that they're locked (a change would need a new agreement version and a new signature).
 */
function TermsEditor({ id, partner, locked, canEdit, onSaved }: { id: number; partner: CityPartnerDetailData["partner"]; locked: boolean; canEdit: boolean; onSaved: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { saving, error } = useAppSelector((s) => s.cityPartner);
  const [rate, setRate] = useState((partner.fee_cents_per_sqft / 100).toFixed(2));
  const [company, setCompany] = useState(partner.company || "");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setRate((partner.fee_cents_per_sqft / 100).toFixed(2));
    setCompany(partner.company || "");
  }, [partner.fee_cents_per_sqft, partner.company]);
  const cents = /^\d{1,3}(\.\d{1,2})?$/.test(rate.trim()) ? Math.round(Number(rate) * 100) : NaN;
  const valid = Number.isInteger(cents) && cents >= 0 && cents <= 10_000 && company.trim().length > 0;
  const dirty = cents !== partner.fee_cents_per_sqft || company.trim() !== (partner.company || "");
  if (locked || !canEdit) {
    return (
      <div className="gw-city-terms">
        <p>
          <strong>{t("cityPartner.ratePerSqft", { rate: centsToMoney(partner.fee_cents_per_sqft) })}</strong> · {partner.company}
        </p>
        {locked ? <p className="pf-hint">{t("cityPartner.termsLocked")}</p> : null}
      </div>
    );
  }
  return (
    <div className="gw-city-terms pf-form">
      <div className="pf-form-grid">
        <label className="pf-field">
          <span>{t("cityPartner.company")} *</span>
          <input value={company} maxLength={200} onChange={(e) => setCompany(e.target.value)} />
        </label>
        <label className="pf-field">
          <span>{t("cityPartner.rate")}</span>
          <input inputMode="decimal" value={rate} aria-invalid={!Number.isInteger(cents)} onChange={(e) => setRate(e.target.value)} />
        </label>
      </div>
      <p className="pf-hint">{t("cityPartner.termsEditable")}</p>
      {!valid ? <p className="form-error">{t("validation.cityPartnerRate")}</p> : null}
      <div className="pf-actions">
        <BusyButton tone="gold" label={t("pf.save")} busy={saving} disabled={!valid || !dirty} onClick={() => setConfirming(true)} />
      </div>
      <DangerConfirmModal
        open={confirming}
        titleKey="cityPartner.termsConfirmTitle"
        confirmLabel={t("cityPartner.termsConfirm")}
        busy={saving}
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          const r = await dispatch(updateCityPartner({ id, body: { fee_cents_per_sqft: cents, company: company.trim() } }));
          if (updateCityPartner.fulfilled.match(r)) {
            setConfirming(false);
            onSaved();
          }
        }}
      >
        <p>{t("cityPartner.termsConfirmText", { company: company.trim(), rate: Number.isInteger(cents) ? centsToMoney(cents) : "" })}</p>
      </DangerConfirmModal>
    </div>
  );
}

const NEXT: Record<string, string[]> = { pending: ["approved", "void"], approved: ["paid", "void"], paid: ["refund_due"], refund_due: ["refunded"], void: ["pending"], refunded: [] };

export default function CityPartnerDetail() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const id = Number(useParams().id);
  const { partner: d, loading, saving, error, invitePreview, previewing } = useAppSelector((s) => s.cityPartner);
  const cities = useAppSelector((s) => s.cities.adminList);
  const canFinance = useAdminCan("finance.write");
  const canManage = useAdminCan("approvals");
  const isSuper = useAppSelector((st) => st.portalAuth.admin.user?.role === "super_admin");
  const [countersigner, setCountersigner] = useState("");
  const [showText, setShowText] = useState(false);
  const [sent, setSent] = useState(false);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  useEffect(() => {
    void dispatch(fetchCityPartner(id));
    if (canManage) void dispatch(fetchAdminCities());
  }, [dispatch, id, canManage]);
  const reload = () => void dispatch(fetchCityPartner(id));
  if (loading && !d) return <div className="portal-page"><KitSkeleton layout="detail" rows={4} /></div>;
  if (!d || d.partner.id !== id) return <ErrorNote error={error} />;
  const p = d.partner;
  const cityIds = d.cities.map((c) => c.id);
  const resendButton = (
    <BusyButton
      icon={Send}
      label={t(sent ? "cityPartner.inviteSent" : "cityPartner.resendInvite")}
      busy={saving}
      disabled={p.status !== "active"}
      onClick={async () => {
        const r = await dispatch(resendCityPartnerInvite(id));
        if (resendCityPartnerInvite.fulfilled.match(r)) {
          setSent(true);
          dispatch(clearInvitePreview());
        }
      }}
    />
  );

  return (
    <div className="portal-page">
      <BackLink to="/admin/city-partners" />
      <PageHeader titleKey="cityPartner.adminTitle" title={p.company || `${p.first_name} ${p.last_name}`} lead={`${p.first_name} ${p.last_name} · ${p.email}`} />
      <ErrorNote error={error} />
      <section className="pf-card pf-form">
        <h3 className="pf-h3">
          <MapPin size={16} aria-hidden /> {t("cityPartner.cities")}
        </h3>
        <MultiSearchPicker
          icon={MapPin}
          label={t("cityPartner.cities")}
          items={cities.map((c) => ({ id: c.id, label: c.name }))}
          selected={cityIds}
          disabled={!canManage}
          empty={t("cities.none")}
          onToggle={async (cid) => {
            await dispatch(updateCityPartner({ id, body: { city_ids: cityIds.includes(cid) ? cityIds.filter((x) => x !== cid) : [...cityIds, cid] } }));
            reload();
          }}
          onCreate={canManage ? (q) => setQuickAdd(q) : undefined}
          createLabel={(q) => (q ? t("cities.addNamed", { name: q }) : t("cities.add"))}
          manageHref={canManage ? "/admin/settings#cities" : undefined}
          manageLabel={t("cities.manage")}
        />
        <CityCreateModal
          initialName={quickAdd}
          onClose={() => setQuickAdd(null)}
          onPicked={async (cid) => {
            await dispatch(updateCityPartner({ id, body: { city_ids: [...new Set([...cityIds, cid])] } }));
            reload();
          }}
        />
        <p className="pf-hint">{d.cities.filter((c) => c.opened_on).length ? t("cityPartner.openedList", { names: d.cities.filter((c) => c.opened_on).map((c) => c.name).join(", ") }) : t("cityPartner.noneOpened")}</p>
        <TermsEditor id={id} partner={p} locked={d.terms_locked} canEdit={canManage} onSaved={reload} />
        {canManage ? (
        <div className="pf-actions">
          <BusyButton icon={Eye} label={t("cityPartner.previewInvite")} busy={previewing} onClick={() => void dispatch(previewCityInvite(id))} />
          {resendButton}
          <BusyButton
            label={t(p.status === "active" ? "cityPartner.deactivate" : "cityPartner.activate")}
            busy={saving}
            onClick={async () => {
              await dispatch(updateCityPartner({ id, body: { status: p.status === "active" ? "inactive" : "active" } }));
              reload();
            }}
          />
        </div>
        ) : null}
        <EmailPreviewModal preview={invitePreview} onClose={() => dispatch(clearInvitePreview())} footer={canManage ? resendButton : null} />
      </section>

      <section className="pf-card pf-form">
        <h3 className="pf-h3">
          <FileSignature size={16} aria-hidden /> {t("cityPartner.agreement")}
        </h3>
        {!d.agreement ? <p className="pf-hint">{t("cityPartner.notSigned")}</p> : null}
        {d.agreement ? (
          <>
            <p>
              {t("cityPartner.signedBy", { name: d.agreement.signer_name, date: fmt.date(d.agreement.signed_at) })} · v{d.agreement.version} · {t("cityPartner.ratePerSqft", { rate: centsToMoney(d.agreement.fee_cents_per_sqft) })}
            </p>
            {d.agreement.countersigned_at ? (
              <p className="pf-hint">
                <BadgeCheck size={14} aria-hidden /> {t("cityPartner.countersignedBy", { name: d.agreement.countersigner_name, date: fmt.date(d.agreement.countersigned_at) })}
              </p>
            ) : !isSuper ? (
              <p className="pf-hint">{t("cityPartner.countersignSuperOnly")}</p>
            ) : (
              <div className="gw-mail-org__add">
                <input value={countersigner} maxLength={200} placeholder={t("cityPartner.countersignName")} aria-label={t("cityPartner.countersignName")} onChange={(e) => setCountersigner(e.target.value)} />
                <BusyButton
                  tone="gold"
                  label={t("cityPartner.countersign")}
                  busy={saving}
                  disabled={countersigner.trim().length < 2}
                  onClick={async () => {
                    await dispatch(countersignCityAgreement({ id, agreementId: d.agreement!.id, name: countersigner.trim() }));
                    reload();
                  }}
                />
              </div>
            )}
            {!d.agreement.countersigned_at ? <p className="pf-hint">{t("cityPartner.countersignHint")}</p> : null}
            <a className="pf-btn pf-btn--sm" href={`/api/admin/city-partners/${id}/agreement/pdf`} target="_blank" rel="noreferrer">
              {t("cityPartner.downloadPdf")}
            </a>{" "}
            <button type="button" className="pf-btn pf-btn--sm" onClick={() => setShowText(!showText)}>
              {t(showText ? "cityPartner.hideText" : "cityPartner.showText")}
            </button>
            {showText && d.agreement_text ? (
              <div className="gw-city-agreement">
                {d.agreement_text}
                <p className="pf-hint">SHA-256 {d.agreement_sha256}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="pf-card pf-form">
        <h3 className="pf-h3">
          <FileText size={16} aria-hidden /> W-9
        </h3>
        {!d.w9 ? <p className="pf-hint">{t("cityPartner.noW9")}</p> : null}
        {d.w9 ? (
          <>
            <p>
              {d.w9.legal_name} · {d.w9.tin_type.toUpperCase()} •••• {d.w9.tin_last4} · {t(`cityPartner.w9Status.${d.w9.status}`)}
            </p>
            {canFinance ? (
              <div className="pf-actions">
                <a className="pf-btn pf-btn--sm" href={`/api/admin/city-partners/${id}/w9s/${d.w9.id}/pdf`} target="_blank" rel="noreferrer">
                  {t("cityPartner.viewW9")}
                </a>
                {d.w9.status === "submitted" ? (
                  <>
                    <BusyButton tone="gold" label={t("cityPartner.acceptW9")} busy={saving} onClick={async () => { await dispatch(reviewCityW9({ id, w9Id: d.w9!.id, status: "accepted" })); reload(); }} />
                    <BusyButton label={t("cityPartner.rejectW9")} busy={saving} onClick={async () => { await dispatch(reviewCityW9({ id, w9Id: d.w9!.id, status: "rejected", note: t("cityPartner.rejectNote") })); reload(); }} />
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="pf-card">
        <h3 className="pf-h3">{t("cityPartner.historyTitle")}</h3>
        {!d.changes.length ? <p className="pf-hint">{t("cityPartner.noHistory")}</p> : null}
        <ul className="gw-mail-org__list">
          {d.changes.map((c, i) => (
            <li key={i}>
              <span className="gw-mail-org__main">
                <strong>{t(`cityPartner.changeField.${c.field}`, { defaultValue: c.field })}</strong>
                {c.before || c.after ? <small>{[showValue(c.field, c.before), showValue(c.field, c.after)].filter(Boolean).join(" → ")}</small> : null}
              </span>
              <small>
                {c.admin_name || t("cityPartner.byPartner")} · {fmt.date(c.at)}
              </small>
            </li>
          ))}
        </ul>
      </section>

      {canFinance ? (
        <section className="pf-card">
          <h3 className="pf-h3">{t("cityPartner.fees")}</h3>
          {!d.fees.length ? <p className="pf-hint">{t("cityPartner.noFees")}</p> : null}
          <ul className="gw-mail-org__list">
            {d.fees.map((f) => (
              <li key={f.id}>
                <span className="gw-mail-org__main">
                  <strong>
                    {centsToMoney(f.amount_cents)} · {f.project_public_id} · {f.city_name}
                  </strong>
                  <small>
                    {f.sq_ft} sq ft × {centsToMoney(f.rate_cents_per_sqft)} · {t("cityPartner.dueOn", { date: fmt.date(`${f.due_on}T12:00:00`) })} · {t(`cityPartner.feeStatus.${f.status}`)}
                  </small>
                </span>
                <span className="gw-mail-org__acts">
                  {(NEXT[f.status] || []).map((n) => (
                    <BusyButton key={n} label={t(`cityPartner.feeAction.${n}`)} busy={saving} onClick={() => void dispatch(updateCityFee({ id: f.id, status: n }))} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
