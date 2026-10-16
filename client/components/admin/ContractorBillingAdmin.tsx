import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeDollarSign, CalendarClock, CreditCard, Lock, Wallet } from "lucide-react";
import MembershipDrawer from "@/components/admin/MembershipDrawer";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminContractorBilling, setContractorPrice } from "@/store/slices/contractorBillingSlice";
import { BusyButton, ErrorNote, Loading, StatusBadge } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

type Mode = "default" | "custom" | "waived";
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Admin → contractor: platform membership. Status, card on file (brand + last
 * 4), free-period end / next charge, portal lock, and the price: default,
 * custom, or waived. `refreshKey` refetches after an approval elsewhere on the page.
 */
export default function ContractorBillingAdmin({
  contractorId,
  canWrite: _legacyCanWrite,
  refreshKey,
  defaultCents = 9990,
}: {
  contractorId: number;
  canWrite: boolean;
  refreshKey?: string;
  defaultCents?: number;
}) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const { admin, adminSaving, adminError } = useAppSelector((s) => s.contractorBilling);
  const data = admin?.id === contractorId ? admin : null;
  const [mode, setMode] = useState<Mode>("default");
  const [custom, setCustom] = useState("");
  const [manage, setManage] = useState(false);
  // Billing changes: super admin, admin, finance.
  const canWrite = useAdminCan("finance.write");

  useEffect(() => {
    void dispatch(fetchAdminContractorBilling(contractorId));
  }, [dispatch, contractorId, refreshKey]);

  if (!data) return <section className="pf-section"><Loading /></section>;
  const b = data.billing;
  const save = () => {
    const price_cents = mode === "default" ? null : mode === "waived" ? 0 : Math.round(Number(custom) * 100);
    if (mode === "custom" && !(Number(custom) > 0)) return;
    void dispatch(setContractorPrice({ id: contractorId, price_cents }));
  };

  return (
    <section className="pf-section gw-membership-admin">
      <MembershipDrawer
        target={manage ? { role: "contractor", id: contractorId } : null}
        onClose={() => {
          setManage(false);
          void dispatch(fetchAdminContractorBilling(contractorId));
        }}
      />
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <BadgeDollarSign size={17} aria-hidden /> {t("ctrBilling.adminTitle")}
        </h2>
        <div className="gw-membership-admin__badges">
          {b.waived ? <span className="pf-badge">{t("ctrBilling.waived")}</span> : <StatusBadge group="affBilling.status" value={b.status} />}
          {b.card_expiring ? <span className="pf-badge pf-badge--warn">{t("billing.expiringBadge")}</span> : null}
          <button type="button" className="pf-btn pf-btn--sm pf-btn--gold" onClick={() => setManage(true)}>
            <Wallet size={14} aria-hidden /> {t("billAdmin.manage")}
          </button>
          {data.locked ? (
            <span className="pf-badge pf-badge--warn">
              <Lock size={12} aria-hidden /> {t("ctrBilling.locked")}
            </span>
          ) : null}
        </div>
      </div>
      {!b.configured ? <p className="pf-hint">{t("ctrBilling.notConfigured")}</p> : null}
      <dl className="gw-membership-admin__facts">
        <div>
          <dt>{t("ctrBilling.price")}</dt>
          <dd>{b.waived ? t("ctrBilling.waived") : b.price_cents ? t("ctrBilling.perMonth", { price: money(b.price_cents) }) : "—"}</dd>
        </div>
        <div>
          <dt>
            <CreditCard size={13} aria-hidden /> {t("affBilling.card")}
          </dt>
          <dd>{b.card ? `${(b.card.brand || "").toUpperCase()} •••• ${b.card.last4}` : t("ctrBilling.noCard")}</dd>
        </div>
        <div>
          <dt>
            <CalendarClock size={13} aria-hidden /> {t("ctrBilling.nextDate")}
          </dt>
          <dd>
            {b.awaiting_approval
              ? t("ctrBilling.startsOnApproval")
              : b.status === "trialing" && b.trial_ends_at
                ? t("ctrBilling.freeUntil", { date: fmt.date(b.trial_ends_at) })
                : b.current_period_end
                  ? fmt.date(b.current_period_end)
                  : "—"}
          </dd>
        </div>
      </dl>
      {canWrite ? (
        <div className="gw-membership-admin__price">
          <div className="gw-membership-admin__modes" role="radiogroup" aria-label={t("ctrBilling.price")}>
            {(["default", "custom", "waived"] as const).map((m) => (
              <label key={m} className="gw-check">
                <input type="radio" name={`price-${contractorId}`} checked={mode === m} onChange={() => setMode(m)} />
                <span>{m === "default" ? t("ctrBilling.modeDefault", { price: money(defaultCents) }) : t(`ctrBilling.mode.${m}`)}</span>
              </label>
            ))}
          </div>
          {mode === "custom" ? (
            <label className="pf-field gw-membership-admin__custom">
              <span>{t("ctrBilling.customLabel")}</span>
              <input type="number" inputMode="decimal" min={1} step="0.01" value={custom} onChange={(e) => setCustom(e.target.value)} />
            </label>
          ) : null}
          <p className="pf-hint">{t("ctrBilling.priceHint")}</p>
          <ErrorNote error={adminError} />
          <BusyButton tone="gold" label={t("pf.save")} busy={adminSaving} disabled={mode === "custom" && !(Number(custom) > 0)} onClick={save} />
        </div>
      ) : null}
    </section>
  );
}
