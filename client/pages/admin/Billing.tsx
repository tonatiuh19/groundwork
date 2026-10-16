import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Search } from "lucide-react";
import type { AdminBillingRow, BillingRole } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchBillingOverview } from "@/store/slices/billingAdminSlice";
import { DataTable, ErrorNote, PageHeader, StatCard, StatusBadge } from "@/components/portal/kit";
import MembershipDrawer from "@/components/admin/MembershipDrawer";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Filter = "all" | "active" | "trialing" | "past_due" | "paused" | "ending" | "canceling" | "awaiting" | "none";

/** Admin → Billing: every contractor + affiliate membership, totals, filters, and the membership drawer. */
export default function AdminBilling() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const { overview, overviewLoading, overviewError } = useAppSelector((s) => s.billingAdmin);
  const [role, setRole] = useState<"all" | BillingRole>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ role: BillingRole; id: number } | null>(null);

  useEffect(() => {
    void dispatch(fetchBillingOverview());
  }, [dispatch]);

  const rows = useMemo(() => {
    const soon = Date.now() + 7 * 86_400_000;
    const needle = q.trim().toLowerCase();
    return (overview?.members ?? []).filter((r) => {
      if (role !== "all" && r.role !== role) return false;
      const b = r.billing;
      const match: Record<Filter, boolean> = {
        all: true,
        active: b.status === "active",
        trialing: b.status === "trialing",
        past_due: b.status === "past_due" || b.status === "incomplete",
        paused: r.locked,
        ending: b.status === "trialing" && Boolean(b.trial_ends_at) && new Date(b.trial_ends_at!).getTime() <= soon,
        canceling: b.cancel_at_period_end,
        awaiting: b.awaiting_approval,
        none: b.status === "none" || b.status === "canceled",
      };
      if (!match[filter]) return false;
      return !needle || `${r.name} ${r.email} ${r.company || ""}`.toLowerCase().includes(needle);
    });
  }, [overview, role, filter, q]);

  const tot = overview?.totals;
  const chip = (f: Filter, n?: number) => (
    <button key={f} type="button" className={cn("gw-pick", filter === f && "is-on")} aria-pressed={filter === f} onClick={() => setFilter(f)}>
      {t(`billAdmin.filter.${f}`)}
      {n != null ? <span className="gw-pick__n">{n}</span> : null}
    </button>
  );

  return (
    <div className="pf-page">
      <PageHeader titleKey="billAdmin.title" leadKey="billAdmin.lead" />
      <ErrorNote error={overviewError} />
      {overview && !overview.configured ? <p className="pf-hint">{t("ctrBilling.notConfigured")}</p> : null}
      <div className="pf-stats">
        <StatCard labelKey="billAdmin.mrr" value={tot ? money(tot.mrr_cents) : "—"} tone="gold" hint={t("billAdmin.mrrHint")} />
        <StatCard labelKey="billAdmin.filter.active" value={tot?.active ?? "—"} />
        <StatCard labelKey="billAdmin.filter.trialing" value={tot?.trialing ?? "—"} hint={tot ? t("billAdmin.endingSoon", { count: tot.trials_ending_7d }) : undefined} />
        <StatCard labelKey="billAdmin.filter.past_due" value={tot?.past_due ?? "—"} tone={tot?.past_due ? "alert" : undefined} hint={tot ? t("billAdmin.pausedCount", { count: tot.paused }) : undefined} />
      </div>

      <section className="pf-section">
        <div className="gw-billing-toolbar">
          <div className="gw-billing-toolbar__roles" role="radiogroup" aria-label={t("billAdmin.roleFilter")}>
            {(["all", "contractor", "affiliate"] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} className={cn("gw-pick", role === r && "is-on")} onClick={() => setRole(r)}>
                {t(`billAdmin.roles.${r}`)}
              </button>
            ))}
          </div>
          <label className="gw-billing-toolbar__search">
            <Search size={15} aria-hidden />
            <input type="search" value={q} placeholder={t("billAdmin.search")} aria-label={t("billAdmin.search")} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <div className="gw-billing-toolbar__filters">
          {chip("all")}
          {chip("active", tot?.active)}
          {chip("trialing", tot?.trialing)}
          {chip("ending", tot?.trials_ending_7d)}
          {chip("past_due", tot?.past_due)}
          {chip("paused", tot?.paused)}
          {chip("canceling", tot?.canceling)}
          {chip("awaiting", tot?.awaiting_approval)}
          {chip("none")}
        </div>
        <DataTable<AdminBillingRow>
          rows={rows}
          loading={overviewLoading}
          emptyKey="billAdmin.empty"
          rowKey={(r) => `${r.role}-${r.id}`}
          onRowClick={(r) => setOpen({ role: r.role, id: r.id })}
          columns={[
            {
              key: "who",
              headerKey: "billAdmin.col.member",
              render: (r) => (
                <div className="gw-billing-who">
                  <strong>{r.name || r.email}</strong>
                  <span>
                    {t(`billAdmin.role.${r.role}`)}
                    {r.company ? ` · ${r.company}` : ""}
                  </span>
                </div>
              ),
            },
            {
              key: "status",
              headerKey: "pf.status",
              render: (r) => (
                <span className="gw-billing-status">
                  {r.billing.waived ? <span className="pf-badge">{t("ctrBilling.waived")}</span> : <StatusBadge group="affBilling.status" value={r.billing.status} />}
                  {r.locked ? <Lock size={13} aria-label={t("ctrBilling.locked")} /> : null}
                </span>
              ),
            },
            { key: "price", headerKey: "ctrBilling.price", render: (r) => (r.billing.waived ? "—" : r.billing.price_cents ? money(r.billing.price_cents) : "—") },
            {
              key: "card",
              headerKey: "affBilling.card",
              render: (r) =>
                r.billing.card ? (
                  <span className={cn(r.billing.card_expiring && "gw-billing-expiring")}>
                    {(r.billing.card.brand || "").toUpperCase()} •••• {r.billing.card.last4}
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              key: "next",
              headerKey: "billAdmin.col.next",
              render: (r) =>
                r.billing.awaiting_approval
                  ? t("ctrBilling.startsOnApproval")
                  : r.billing.status === "trialing" && r.billing.trial_ends_at
                    ? t("ctrBilling.freeUntil", { date: fmt.date(r.billing.trial_ends_at) })
                    : r.billing.current_period_end && r.billing.status !== "canceled"
                      ? `${fmt.date(r.billing.current_period_end)}${r.billing.cancel_at_period_end ? ` · ${t("billAdmin.ends")}` : ""}`
                      : "—",
            },
          ]}
        />
      </section>
      <MembershipDrawer target={open} onClose={() => setOpen(null)} />
    </div>
  );
}
