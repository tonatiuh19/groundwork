import { useEffect, useState } from "react";
import { CheckCircle2, Download, FileSignature, FileText, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminAffiliateOnboarding,
  reviewAffiliateW9,
  setAffiliateSubscriptionPrice,
  voidAffiliateAgreement,
} from "@/store/slices/affiliateOnboardingSlice";
import { BusyButton, ErrorNote, Loading, Modal, StatusBadge } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";

/**
 * Admin → Affiliate → "Agreement & W-9": set the monthly price after the
 * onboarding call (unlocks signing + emails the affiliate), view the signed
 * agreement, review the W-9 (PDF with full TIN is finance-only), void to re-sign.
 */
export default function AffiliateOnboardingPanel({ affiliateId }: { affiliateId: number }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const canApprove = useAdminCan("approvals");
  const canFinanceRead = useAdminCan("finance.read");
  const canFinanceWrite = useAdminCan("finance.write");
  const { admin, adminFor, adminLoading, adminError, adminSaving } = useAppSelector((s) => s.affiliateOnboarding);
  const [price, setPrice] = useState("");
  const [voidFor, setVoidFor] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [rejectFor, setRejectFor] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const load = () => void dispatch(fetchAdminAffiliateOnboarding(affiliateId));
  useEffect(load, [dispatch, affiliateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = admin && adminFor === affiliateId ? admin : null;
  useEffect(() => {
    const c = data?.state.subscription_price_cents;
    setPrice(c == null ? "" : (c / 100).toFixed(2));
  }, [data?.state.subscription_price_cents]);

  if (adminLoading && !data) return <section className="pf-section"><Loading /></section>;
  if (!data) return <section className="pf-section"><ErrorNote error={adminError} /></section>;
  const { state } = data;
  const signed = data.agreements.find((a) => a.status === "signed");
  const latestW9 = data.w9s[0];
  const priceCents = price.trim() === "" ? null : Math.round(Number(price) * 100);
  const priceValid = priceCents === null || (Number.isFinite(priceCents) && priceCents >= 0);

  return (
    <section className="pf-section gw-onboard-admin">
      <div className="pf-section-head">
        <h2 className="pf-h2">{t("affAgreement.adminTitle")}</h2>
        {state.payout_ready ? (
          <span className="pf-badge pf-badge--good"><CheckCircle2 size={13} aria-hidden /> {t("affAgreement.payoutReadyShort")}</span>
        ) : (
          <span className="pf-badge pf-badge--warn"><ShieldAlert size={13} aria-hidden /> {t("affAgreement.payoutHeldShort")}</span>
        )}
      </div>
      <ErrorNote error={adminError} />

      <div className="gw-onboard-admin-grid">
        <div className="pf-card">
          <h3 className="pf-h3"><FileSignature size={16} aria-hidden /> {t("affAgreement.step1")}</h3>
          <label className="pf-field">
            <span>{t("affAgreement.priceLabel")}</span>
            <div className="gw-price-row">
              <span aria-hidden>$</span>
              <input
                inputMode="decimal"
                value={price}
                placeholder={t("affAgreement.pricePending")}
                disabled={!canApprove || state.agreement_signed}
                onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <span className="pf-muted">{t("affAgreement.perMonth")}</span>
            </div>
            <small className="pf-hint">
              {state.agreement_signed ? t("affAgreement.priceLocked") : t("affAgreement.priceHint")}
            </small>
          </label>
          {canApprove && !state.agreement_signed ? (
            <BusyButton
              tone="gold"
              label={t(state.subscription_price_cents == null ? "affAgreement.priceSaveSend" : "pf.save")}
              busy={adminSaving}
              disabled={!priceValid || priceCents === state.subscription_price_cents}
              onClick={async () => {
                const r = await dispatch(setAffiliateSubscriptionPrice({ id: affiliateId, subscription_price_cents: priceCents }));
                if (setAffiliateSubscriptionPrice.fulfilled.match(r)) load();
              }}
            />
          ) : null}

          {signed ? (
            <div className="gw-onboard-record">
              <p>
                <StatusBadge group="affAgreement.status" value="signed" />{" "}
                {t("affAgreement.adminSigned", {
                  name: signed.legal_name,
                  date: fmt.date(signed.signed_at),
                  version: signed.template_version,
                  lang: signed.lang.toUpperCase(),
                })}
              </p>
              <p className="pf-muted">
                {t("affAgreement.adminSignedPrice", { price: fmt.money(signed.subscription_price_cents) })}
                {signed.sponsor_name ? ` · ${t("affAgreement.sponsor")}: ${signed.sponsor_name}` : ""}
              </p>
              <div className="pf-actions">
                <a className="pf-btn" href={`/api/admin/affiliates/${affiliateId}/agreements/${signed.id}/pdf`} target="_blank" rel="noreferrer">
                  <Download size={15} aria-hidden /> {t("affAgreement.downloadSigned")}
                </a>
                {canApprove ? (
                  <button type="button" className="pf-btn" onClick={() => { setReason(""); setVoidFor(signed.id); }}>
                    {t("affAgreement.voidCta")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="pf-muted">{t(state.subscription_price_cents == null ? "affAgreement.adminWaitingPrice" : "affAgreement.adminWaitingSign")}</p>
          )}
        </div>

        <div className="pf-card">
          <h3 className="pf-h3"><FileText size={16} aria-hidden /> {t("affAgreement.step2")}</h3>
          {latestW9 ? (
            <div className="gw-onboard-record">
              <p>
                <StatusBadge group="affAgreement.w9Status" value={latestW9.status} />{" "}
                {t("affAgreement.adminW9", {
                  name: latestW9.legal_name,
                  type: latestW9.tin_type.toUpperCase(),
                  last4: latestW9.tin_last4,
                  date: fmt.date(latestW9.signed_at),
                })}
              </p>
              <p className="pf-muted">
                {t(`affAgreement.w9Class.${latestW9.tax_classification}`)}
                {latestW9.llc_tax_class ? ` (${latestW9.llc_tax_class})` : ""} · {latestW9.address}, {latestW9.city_state_zip}
              </p>
              {latestW9.review_note ? <p className="pf-muted">{latestW9.review_note}</p> : null}
              <div className="pf-actions">
                {canFinanceRead ? (
                  <a className="pf-btn" href={`/api/admin/affiliates/${affiliateId}/w9s/${latestW9.id}/pdf`} target="_blank" rel="noreferrer">
                    <Download size={15} aria-hidden /> {t("affAgreement.downloadW9")}
                  </a>
                ) : (
                  <span className="pf-hint">{t("affAgreement.w9FinanceOnly")}</span>
                )}
                {canFinanceWrite && latestW9.status === "submitted" ? (
                  <>
                    <BusyButton
                      tone="gold"
                      label={t("affAgreement.w9Accept")}
                      busy={adminSaving}
                      onClick={async () => {
                        const r = await dispatch(reviewAffiliateW9({ id: affiliateId, w9Id: latestW9.id, status: "accepted" }));
                        if (reviewAffiliateW9.fulfilled.match(r)) load();
                      }}
                    />
                    <button type="button" className="pf-btn" onClick={() => { setNote(""); setRejectFor(latestW9.id); }}>
                      {t("affAgreement.w9Reject")}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="pf-muted">{t("affAgreement.adminNoW9")}</p>
          )}
        </div>
      </div>

      <Modal open={voidFor != null} titleKey="affAgreement.voidTitle" onClose={() => setVoidFor(null)}>
        <div className="pf-form">
          <p className="pf-muted">{t("affAgreement.voidHelp")}</p>
          <label className="pf-field">
            <span>{t("affAgreement.reason")}</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="pf-actions">
            <button type="button" className="pf-btn" onClick={() => setVoidFor(null)}>{t("pf.cancel")}</button>
            <BusyButton
              tone="gold"
              label={t("affAgreement.voidCta")}
              busy={adminSaving}
              disabled={reason.trim().length < 5}
              onClick={async () => {
                const r = await dispatch(voidAffiliateAgreement({ id: affiliateId, agreementId: voidFor!, reason: reason.trim() }));
                if (voidAffiliateAgreement.fulfilled.match(r)) {
                  setVoidFor(null);
                  load();
                }
              }}
            />
          </div>
        </div>
      </Modal>

      <Modal open={rejectFor != null} titleKey="affAgreement.w9RejectTitle" onClose={() => setRejectFor(null)}>
        <div className="pf-form">
          <p className="pf-muted">{t("affAgreement.w9RejectHelp")}</p>
          <label className="pf-field">
            <span>{t("affAgreement.reason")}</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="pf-actions">
            <button type="button" className="pf-btn" onClick={() => setRejectFor(null)}>{t("pf.cancel")}</button>
            <BusyButton
              tone="gold"
              label={t("affAgreement.w9Reject")}
              busy={adminSaving}
              disabled={note.trim().length < 5}
              onClick={async () => {
                const r = await dispatch(reviewAffiliateW9({ id: affiliateId, w9Id: rejectFor!, status: "rejected", note: note.trim() }));
                if (reviewAffiliateW9.fulfilled.match(r)) {
                  setRejectFor(null);
                  load();
                }
              }}
            />
          </div>
        </div>
      </Modal>
    </section>
  );
}
