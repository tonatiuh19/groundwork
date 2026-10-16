import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, MessagesSquare, Send, Sparkles, Wallet } from "lucide-react";
import MembershipDrawer from "@/components/admin/MembershipDrawer";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminAffiliateBilling, resendAffiliateWelcome } from "@/store/slices/affiliateOnboardingSlice";
import { fetchAdminAssistantLog } from "@/store/slices/affiliateHelpSlice";
import { BusyButton, StatusBadge, useBusyAction } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";

/**
 * Admin → Affiliate → "Platform plan & help": subscription status (free
 * period / active / past due), card on file (brand + last 4), re-send the
 * welcome (presentation + new secure link), and what they asked the assistant.
 */
export default function AffiliateBillingAdminPanel({ affiliateId }: { affiliateId: number }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const canApprove = useAdminCan("approvals");
  const { adminBilling, adminBillingFor } = useAppSelector((s) => s.affiliateOnboarding);
  const { adminLog, adminLogFor } = useAppSelector((s) => s.affiliateHelp);
  const resend = useBusyAction(900);
  const [showLog, setShowLog] = useState(false);
  const [manage, setManage] = useState(false);

  useEffect(() => {
    void dispatch(fetchAdminAffiliateBilling(affiliateId));
    void dispatch(fetchAdminAssistantLog(affiliateId));
  }, [dispatch, affiliateId]);

  const b = adminBillingFor === affiliateId ? adminBilling : null;
  const log = adminLogFor === affiliateId ? adminLog : [];
  const questions = log.filter((m) => m.role === "user").length;
  const handoffs = log.filter((m) => m.role === "assistant" && m.handoff).length;

  return (
    <section className="pf-section gw-plan-admin">
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <CreditCard size={17} aria-hidden /> {t("affBillingAdmin.title")}
        </h2>
        {b ? <StatusBadge group="affBilling.status" value={b.status} /> : null}
        {b?.card_expiring ? <span className="pf-badge pf-badge--warn">{t("billing.expiringBadge")}</span> : null}
        <button type="button" className="pf-btn pf-btn--sm pf-btn--gold" onClick={() => setManage(true)}>
          <Wallet size={14} aria-hidden /> {t("billAdmin.manage")}
        </button>
      </div>
      <MembershipDrawer
        target={manage ? { role: "affiliate", id: affiliateId } : null}
        onClose={() => {
          setManage(false);
          void dispatch(fetchAdminAffiliateBilling(affiliateId));
        }}
      />
      {b ? (
        <dl className="gw-plan-admin__facts">
          <div>
            <dt>{t("affBillingAdmin.price")}</dt>
            <dd>{b.price_cents != null ? `${fmt.money(b.price_cents)} / ${t("affBillingAdmin.month")}` : "—"}</dd>
          </div>
          <div>
            <dt>{t("affBillingAdmin.card")}</dt>
            <dd>{b.card ? `${(b.card.brand || "").toUpperCase()} •••• ${b.card.last4}` : t("affBillingAdmin.noCard")}</dd>
          </div>
          <div>
            <dt>{b.status === "trialing" ? t("affBillingAdmin.freeUntil") : t("affBillingAdmin.nextCharge")}</dt>
            <dd>{fmt.date(b.status === "trialing" ? b.trial_ends_at : b.current_period_end) || "—"}</dd>
          </div>
          {b.cancel_at_period_end ? (
            <div>
              <dt>{t("affBillingAdmin.cancels")}</dt>
              <dd>{fmt.date(b.current_period_end) || "—"}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {!b?.configured && b ? <p className="pf-hint">{t("affBillingAdmin.notConfigured")}</p> : null}

      <div className="pf-actions gw-plan-admin__actions">
        {canApprove ? (
          <BusyButton
            icon={Send}
            label={t("affBillingAdmin.resend")}
            busyLabel={t("affBillingAdmin.resending")}
            doneLabel={t("affBillingAdmin.resent")}
            busy={resend.busy}
            done={resend.done}
            onClick={() =>
              void resend.run(async () => resendAffiliateWelcome.fulfilled.match(await dispatch(resendAffiliateWelcome(affiliateId))), { flash: true })
            }
          />
        ) : null}
        <button type="button" className="pf-btn" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
          <MessagesSquare size={14} aria-hidden /> {t("affBillingAdmin.questions", { count: questions })}
          {handoffs ? <span className="pf-badge pf-badge--warn">{t("affBillingAdmin.handoffs", { count: handoffs })}</span> : null}
        </button>
      </div>
      <p className="pf-hint">{t("affBillingAdmin.resendHint")}</p>

      {showLog ? (
        <div className="gw-assistant__log gw-assistant__log--admin">
          {!log.length ? <p className="gw-assistant__empty">{t("affBillingAdmin.noQuestions")}</p> : null}
          {log.map((m) => (
            <div key={m.id} className={m.role === "user" ? "gw-bubble is-me" : "gw-bubble is-bot"}>
              {m.role === "assistant" ? (
                <span className="gw-bubble__who" aria-hidden>
                  <Sparkles size={12} />
                </span>
              ) : null}
              <p>{m.content}</p>
              <span className="gw-bubble__meta">
                {fmt.relative(m.created_at)}
                {m.handoff ? ` · ${t("affHelp.handedOff")}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
