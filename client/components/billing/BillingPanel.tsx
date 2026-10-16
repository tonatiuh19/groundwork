import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarClock, CreditCard, Gift, Hourglass, Lock, RefreshCw } from "lucide-react";
import type { PlatformBilling } from "@shared/api";
import { BusyButton, StatusBadge } from "@/components/portal/kit";
import SecureCardForm, { type CardFormBindings } from "@/components/billing/SecureCardForm";
import { useFormatters } from "@/lib/format";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Platform plan for any paying role: the plan (free period, then monthly), the
 * card on file with "Replace card", or the secure card form. The free period
 * starts on approval — a card saved while pending shows "starts when approved".
 * `onCancel` adds cancel / resume at the end of the paid month.
 */
export default function BillingPanel({
  billing,
  lockedNote,
  card,
  onCancel,
}: {
  billing: PlatformBilling;
  /** Why the card form isn't available yet (e.g. "sign the agreement first"). */
  lockedNote?: string | null;
  card: Omit<CardFormBindings, "onSaved">;
  onCancel?: (resume: boolean) => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const [replacing, setReplacing] = useState(false);
  const live = billing.status !== "none" && billing.status !== "canceled";
  const onFile = Boolean(billing.card) && (live || billing.awaiting_approval);
  const price = billing.price_cents ? money(billing.price_cents) : null;

  if (billing.waived) {
    return (
      <div className="gw-plan">
        <span className="gw-plan__icon" aria-hidden>
          <Gift size={18} />
        </span>
        <div>
          <strong>{t("billing.waivedTitle")}</strong>
          <span>{t("billing.waivedLead")}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="gw-plan">
        <span className="gw-plan__icon" aria-hidden>
          <Gift size={18} />
        </span>
        <div>
          <strong>{t("affBilling.planTitle", { days: billing.trial_days })}</strong>
          <span>
            {price ? t("affBilling.planThen", { price }) : t("affBilling.planThenPending")}{" "}
            {!live && !billing.approved ? t("billing.startsOnApproval") : null}
          </span>
        </div>
        {billing.status !== "none" ? <StatusBadge group="affBilling.status" value={billing.status} /> : null}
      </div>

      {lockedNote ? (
        <p className="gw-onboard-note">
          <Lock size={15} aria-hidden /> {lockedNote}
        </p>
      ) : onFile && !replacing ? (
        <div className="gw-card-onfile">
          <span className="gw-card-onfile__chip" aria-hidden>
            <CreditCard size={18} />
          </span>
          <div className="gw-card-onfile__body">
            <strong>
              {(billing.card!.brand || t("affBilling.card")).toUpperCase()} •••• {billing.card!.last4}
            </strong>
            <span>{billing.card!.exp ? t("affBilling.expires", { exp: billing.card!.exp }) : null}</span>
            {billing.awaiting_approval ? (
              <span className="gw-card-onfile__when">
                <Hourglass size={13} aria-hidden /> {t("billing.awaitingApproval", { days: billing.trial_days })}
              </span>
            ) : billing.status === "trialing" && billing.trial_ends_at ? (
              <span className="gw-card-onfile__when">
                <CalendarClock size={13} aria-hidden /> {t("affBilling.firstCharge", { date: fmt.date(billing.trial_ends_at), price: price || "" })}
              </span>
            ) : billing.current_period_end ? (
              <span className="gw-card-onfile__when">
                <CalendarClock size={13} aria-hidden /> {t("affBilling.nextCharge", { date: fmt.date(billing.current_period_end), price: price || "" })}
              </span>
            ) : null}
            {billing.status === "past_due" ? <span className="form-error">{t("affBilling.pastDue")}</span> : null}
            {billing.card_expiring && billing.status !== "past_due" ? <span className="form-error">{t("billing.expiringSoon")}</span> : null}
          </div>
          <div className="gw-card-onfile__actions">
            <span className="gw-card-onfile__ok">
              <BadgeCheck size={15} aria-hidden /> {t("affBilling.onFile")}
            </span>
            <button type="button" className="pf-btn pf-btn--sm" onClick={() => setReplacing(true)}>
              <RefreshCw size={13} aria-hidden /> {t("affBilling.replace")}
            </button>
            {onCancel && (billing.status === "trialing" || billing.status === "active") ? (
              <BusyButton
                className="pf-btn--sm"
                label={billing.cancel_at_period_end ? t("affBilling.resume") : t("affBilling.cancel")}
                busy={card.busy}
                onClick={() => {
                  if (billing.cancel_at_period_end || window.confirm(t("affBilling.cancelConfirm"))) {
                    onCancel(billing.cancel_at_period_end);
                  }
                }}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <SecureCardForm {...card} onSaved={() => setReplacing(false)} />
      )}
    </>
  );
}
