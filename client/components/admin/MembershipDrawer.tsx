import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Ban,
  CalendarPlus,
  CreditCard,
  ExternalLink,
  FileText,
  History,
  Lock,
  Play,
  Receipt,
  RotateCcw,
  Send,
  Tag,
  Wallet,
} from "lucide-react";
import type { BillingInvoice, BillingRole } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  cancelMembership,
  clearBillingActionError,
  closeMembership,
  extendMembership,
  fetchBillingOverview,
  fetchMembership,
  refundInvoice,
  resumeMembership,
  sendCardLink,
  setMembershipPrice,
} from "@/store/slices/billingAdminSlice";
import { SideDrawer } from "@/components/portal/SideDrawer";
import { BusyButton, ErrorNote, Loading, StatusBadge } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const toCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));

type Panel = null | "cancel" | "extend" | "price" | "link" | { refund: BillingInvoice };

/**
 * Admin → one membership (affiliate or contractor) in a slide-over: plan, card,
 * invoices with receipts + refunds, staff actions (cancel / resume / free days /
 * price / secure card link) and the action log. Opened from Admin → Billing and
 * from each contractor / affiliate record.
 */
export default function MembershipDrawer({
  target,
  onClose,
}: {
  target: { role: BillingRole; id: number } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const canWrite = useAdminCan("finance.write");
  const { member: data, acting, actionError } = useAppSelector((s) => s.billingAdmin);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("30");
  const [amount, setAmount] = useState("");
  const [priceMode, setPriceMode] = useState<"default" | "custom" | "waived">("default");
  const [price, setPrice] = useState("");
  const [linkPrice, setLinkPrice] = useState("");
  const [linkDays, setLinkDays] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (target) void dispatch(fetchMembership(target));
    setPanel(null);
  }, [dispatch, target]);

  const open = (p: Panel) => {
    dispatch(clearBillingActionError());
    setReason("");
    setAmount("");
    setPanel(p);
  };
  const done = async (r: { meta: { requestStatus: string } }) => {
    if (r.meta.requestStatus !== "fulfilled" || !target) return;
    setPanel(null);
    await dispatch(fetchMembership(target));
    void dispatch(fetchBillingOverview());
  };
  const close = () => {
    dispatch(closeMembership());
    onClose();
  };

  const ready = data && target && data.member.role === target.role && data.member.id === target.id ? data : null;
  const b = ready?.billing;
  const live = b && (b.status === "trialing" || b.status === "active" || b.status === "past_due" || b.status === "incomplete");
  const reasonOk = reason.trim().length >= 3;

  const reasonField = (
    <label className="pf-field">
      <span>{t("billAdmin.reason")}</span>
      <textarea rows={2} value={reason} maxLength={2000} placeholder={t("billAdmin.reasonHint")} onChange={(e) => setReason(e.target.value)} />
    </label>
  );

  return (
    <SideDrawer
      open={Boolean(target)}
      onClose={close}
      busy={acting}
      icon={<Wallet size={18} aria-hidden />}
      title={ready ? ready.member.name || ready.member.email : t("billAdmin.membership")}
      subtitle={ready ? `${t(`billAdmin.role.${ready.member.role}`)} · ${ready.member.email}` : undefined}
    >
      {!ready || !b ? (
        <Loading />
      ) : (
        <div className="gw-mdrawer">
          <div className="gw-mdrawer__badges">
            {b.waived ? <span className="pf-badge">{t("ctrBilling.waived")}</span> : <StatusBadge group="affBilling.status" value={b.status} />}
            {ready.locked ? (
              <span className="pf-badge pf-badge--warn">
                <Lock size={12} aria-hidden /> {t("ctrBilling.locked")}
              </span>
            ) : null}
            {b.cancel_at_period_end ? <span className="pf-badge pf-badge--warn">{t("billAdmin.canceling")}</span> : null}
            {b.card_expiring ? <span className="pf-badge pf-badge--warn">{t("billing.expiringBadge")}</span> : null}
            {b.awaiting_approval ? <span className="pf-badge">{t("ctrBilling.startsOnApproval")}</span> : null}
          </div>

          <dl className="gw-membership-admin__facts">
            <Fact label={t("ctrBilling.price")}>{b.waived ? t("ctrBilling.waived") : b.price_cents ? t("ctrBilling.perMonth", { price: money(b.price_cents) }) : "—"}</Fact>
            <Fact label={t("affBilling.card")} icon={<CreditCard size={13} aria-hidden />}>
              {b.card ? `${(b.card.brand || "").toUpperCase()} •••• ${b.card.last4}${b.card.exp ? ` · ${b.card.exp}` : ""}` : t("ctrBilling.noCard")}
            </Fact>
            <Fact label={b.status === "trialing" ? t("billAdmin.freeUntil") : t("billAdmin.nextCharge")}>
              {b.status === "trialing" && b.trial_ends_at ? fmt.date(b.trial_ends_at) : b.current_period_end && live ? fmt.date(b.current_period_end) : "—"}
            </Fact>
          </dl>

          <ErrorNote error={actionError} />

          {canWrite ? (
            <div className="gw-mdrawer__actions" role="group" aria-label={t("billAdmin.actions")}>
              {live && !b.cancel_at_period_end ? (
                <button type="button" className={cn("pf-btn pf-btn--sm", panel === "cancel" && "is-on")} onClick={() => open("cancel")}>
                  <Ban size={14} aria-hidden /> {t("billAdmin.cancel")}
                </button>
              ) : null}
              {live && b.cancel_at_period_end ? (
                <BusyButton
                  className="pf-btn--sm"
                  icon={Play}
                  label={t("billAdmin.resume")}
                  busy={acting}
                  onClick={() => void dispatch(resumeMembership(target!)).then(done)}
                />
              ) : null}
              {live ? (
                <button type="button" className={cn("pf-btn pf-btn--sm", panel === "extend" && "is-on")} onClick={() => open("extend")}>
                  <CalendarPlus size={14} aria-hidden /> {t("billAdmin.extend")}
                </button>
              ) : null}
              <button type="button" className={cn("pf-btn pf-btn--sm", panel === "price" && "is-on")} onClick={() => open("price")}>
                <Tag size={14} aria-hidden /> {t("billAdmin.price")}
              </button>
              {!live && !b.waived && ready.member.status === "active" ? (
                <button type="button" className={cn("pf-btn pf-btn--sm pf-btn--gold", panel === "link" && "is-on")} onClick={() => open("link")}>
                  <Send size={14} aria-hidden /> {t("billAdmin.sendLink")}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="pf-hint">{t("billAdmin.readOnly")}</p>
          )}

          {panel === "cancel" ? (
            <ActionCard title={t("billAdmin.cancelTitle")}>
              {reasonField}
              <div className="gw-mdrawer__row">
                <BusyButton
                  label={t("billAdmin.cancelPeriodEnd")}
                  busy={acting}
                  disabled={!reasonOk}
                  onClick={() => void dispatch(cancelMembership({ ...target!, when: "period_end", reason })).then(done)}
                />
                <BusyButton
                  tone="danger"
                  label={t("billAdmin.cancelNow")}
                  busy={acting}
                  disabled={!reasonOk}
                  onClick={() => {
                    if (window.confirm(t("billAdmin.cancelNowConfirm"))) void dispatch(cancelMembership({ ...target!, when: "now", reason })).then(done);
                  }}
                />
              </div>
            </ActionCard>
          ) : null}

          {panel === "extend" ? (
            <ActionCard title={t("billAdmin.extendTitle")} lead={t("billAdmin.extendLead")}>
              <div className="gw-mdrawer__chips" role="radiogroup" aria-label={t("billAdmin.days")}>
                {["7", "14", "30", "60", "90"].map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={days === d} className={cn("gw-pick", days === d && "is-on")} onClick={() => setDays(d)}>
                    +{d}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={365}
                  inputMode="numeric"
                  aria-label={t("billAdmin.days")}
                  className="gw-mdrawer__num"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
              {reasonField}
              <BusyButton
                tone="gold"
                label={t("billAdmin.extendCta", { count: Number(days) || 0 })}
                busy={acting}
                disabled={!reasonOk || !(Number(days) >= 1 && Number(days) <= 365)}
                onClick={() => void dispatch(extendMembership({ ...target!, days: Number(days), reason })).then(done)}
              />
            </ActionCard>
          ) : null}

          {panel === "price" ? (
            <ActionCard title={t("billAdmin.priceTitle")} lead={t("ctrBilling.priceHint")}>
              <div className="gw-membership-admin__modes" role="radiogroup" aria-label={t("ctrBilling.price")}>
                {(["default", "custom", "waived"] as const).map((m) => (
                  <label key={m} className="gw-check">
                    <input type="radio" name="gw-mprice" checked={priceMode === m} onChange={() => setPriceMode(m)} />
                    <span>{t(m === "default" ? `billAdmin.priceDefault.${ready.member.role}` : `ctrBilling.mode.${m}`)}</span>
                  </label>
                ))}
              </div>
              {priceMode === "custom" ? (
                <label className="pf-field gw-membership-admin__custom">
                  <span>{t("ctrBilling.customLabel")}</span>
                  <input type="number" inputMode="decimal" min={1} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                </label>
              ) : null}
              {reasonField}
              <BusyButton
                tone="gold"
                label={t("pf.save")}
                busy={acting}
                disabled={priceMode === "custom" && !(Number(price) > 0)}
                onClick={() =>
                  void dispatch(
                    setMembershipPrice({
                      ...target!,
                      price_cents: priceMode === "default" ? null : priceMode === "waived" ? 0 : toCents(price),
                      reason,
                    }),
                  ).then(done)
                }
              />
            </ActionCard>
          ) : null}

          {panel === "link" ? (
            <ActionCard title={t("billAdmin.linkTitle")} lead={t("billAdmin.linkLead")}>
              <div className="pf-form-grid">
                <label className="pf-field">
                  <span>{t("billAdmin.linkPrice")}</span>
                  <input type="number" inputMode="decimal" min={1} step="0.01" placeholder={b.price_cents ? (b.price_cents / 100).toFixed(2) : ""} value={linkPrice} onChange={(e) => setLinkPrice(e.target.value)} />
                </label>
                <label className="pf-field">
                  <span>{t("billAdmin.linkDays")}</span>
                  <input type="number" inputMode="numeric" min={0} max={365} placeholder={String(b.trial_days)} value={linkDays} onChange={(e) => setLinkDays(e.target.value)} />
                </label>
              </div>
              <label className="pf-field">
                <span>{t("billAdmin.linkNote")}</span>
                <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {ready.open_link ? <p className="pf-hint">{t("billAdmin.linkOpen", { date: fmt.date(ready.open_link.expires_at) })}</p> : null}
              <BusyButton
                tone="gold"
                icon={Send}
                label={t("billAdmin.linkSend")}
                busy={acting}
                disabled={(linkPrice !== "" && !(Number(linkPrice) > 0)) || (linkDays !== "" && !(Number(linkDays) >= 0 && Number(linkDays) <= 365))}
                onClick={() =>
                  void dispatch(
                    sendCardLink({ ...target!, price_cents: toCents(linkPrice), free_days: linkDays === "" ? null : Number(linkDays), note }),
                  ).then(done)
                }
              />
            </ActionCard>
          ) : null}

          {panel && typeof panel === "object" ? (
            <ActionCard
              title={t("billAdmin.refundTitle", { number: panel.refund.number || panel.refund.id })}
              lead={t("billAdmin.refundLead", { max: money(panel.refund.amount_paid - panel.refund.amount_refunded) })}
            >
              <label className="pf-field gw-membership-admin__custom">
                <span>{t("billAdmin.refundAmount")}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step="0.01"
                  placeholder={((panel.refund.amount_paid - panel.refund.amount_refunded) / 100).toFixed(2)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              {reasonField}
              <BusyButton
                tone="danger"
                icon={RotateCcw}
                label={t("billAdmin.refundCta")}
                busy={acting}
                disabled={!reasonOk}
                onClick={() => {
                  if (window.confirm(t("billAdmin.refundConfirm")))
                    void dispatch(refundInvoice({ ...target!, invoice_id: panel.refund.id, amount_cents: toCents(amount), reason })).then(done);
                }}
              />
            </ActionCard>
          ) : null}

          <section className="gw-mdrawer__section">
            <h3>
              <Receipt size={15} aria-hidden /> {t("billAdmin.invoices")}
            </h3>
            {ready.invoices.length ? (
              <ul className="gw-invoices">
                {ready.invoices.map((inv) => (
                  <li key={inv.id} className="gw-invoice">
                    <div className="gw-invoice__main">
                      <strong>{money(inv.amount_paid || inv.amount_due)}</strong>
                      <span>
                        {fmt.date(inv.created)}
                        {inv.number ? ` · ${inv.number}` : ""}
                      </span>
                      {inv.amount_refunded ? <span className="gw-invoice__refund">{t("billAdmin.refunded", { amount: money(inv.amount_refunded) })}</span> : null}
                    </div>
                    <StatusBadge group="billAdmin.invoiceStatus" value={inv.status} />
                    <div className="gw-invoice__links">
                      {inv.receipt_url ? (
                        <a className="pf-btn pf-btn--sm" href={inv.receipt_url} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} aria-hidden /> {t("billAdmin.receipt")}
                        </a>
                      ) : null}
                      {inv.pdf_url ? (
                        <a className="pf-btn pf-btn--sm" href={inv.pdf_url} target="_blank" rel="noreferrer">
                          <FileText size={13} aria-hidden /> PDF
                        </a>
                      ) : null}
                      {canWrite && inv.refundable ? (
                        <button type="button" className="pf-btn pf-btn--sm" onClick={() => open({ refund: inv })}>
                          <RotateCcw size={13} aria-hidden /> {t("billAdmin.refund")}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pf-muted">{t("billAdmin.noInvoices")}</p>
            )}
          </section>

          <section className="gw-mdrawer__section">
            <h3>
              <History size={15} aria-hidden /> {t("billAdmin.activity")}
            </h3>
            {ready.actions.length ? (
              <ol className="gw-mlog">
                {ready.actions.map((a) => (
                  <li key={a.id}>
                    <strong>{t(`billAdmin.action.${a.action}`, { defaultValue: a.action, ...(a.detail as Record<string, unknown>) })}</strong>
                    <span>
                      {a.admin_name || t("billAdmin.system")} · {fmt.date(a.created_at)}
                    </span>
                    {a.reason ? <em>{a.reason}</em> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="pf-muted">{t("billAdmin.noActivity")}</p>
            )}
          </section>
        </div>
      )}
    </SideDrawer>
  );
}

function Fact({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>
        {icon} {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function ActionCard({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="gw-mdrawer__card">
      <h4>{title}</h4>
      {lead ? <p className="pf-hint">{lead}</p> : null}
      {children}
    </div>
  );
}
