import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FolderKanban,
  Handshake,
  HardHat,
  Inbox,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchCommandCenter } from "@/store/slices/commandCenterSlice";
import { ErrorNote } from "@/components/portal/kit";
import PageMeta from "@/components/PageMeta";
import { HBars, Sparkline, WeeklyBars } from "@/components/admin/dashboard/Charts";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

const INBOX_ICON: Record<string, LucideIcon> = {
  leads_new: Inbox,
  affiliates_pending: Handshake,
  applications_review: ClipboardCheck,
  clients_pending: Users,
  draws_submitted: Wallet,
  texts_unread: MessageSquare,
  billing_past_due: CreditCard,
  billing_paused: CreditCard,
  trials_ending: CalendarClock,
  commissions_to_approve: Banknote,
  events_upcoming: CalendarPlus,
  campaigns_scheduled: Megaphone,
};
const ACT_ICON: Record<string, LucideIcon> = {
  lead: Inbox,
  client: Users,
  affiliate: Handshake,
  contractor: HardHat,
  milestone: FolderKanban,
  application_submitted: ClipboardCheck,
  application_approved: BadgeCheck,
  application_denied: ClipboardCheck,
};
const REFRESH_MS = 60_000;

/**
 * Staff command center: what needs you now, today's schedule, money, trends
 * and live activity — tailored to the signed-in role. Refreshes every minute
 * and when the tab comes back into focus.
 */
export default function Dashboard() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((s) => s.commandCenter);
  const me = useAppSelector((s) => s.portalAuth.admin.user);
  const [mine, setMine] = useState(false);
  const can = {
    leads: useAdminCan("leads"),
    projects: useAdminCan("projects.read"),
    events: useAdminCan("events"),
    campaigns: useAdminCan("campaigns"),
    finance: useAdminCan("finance.read"),
  };

  const load = useCallback(() => void dispatch(fetchCommandCenter({ mine })), [dispatch, mine]);
  useEffect(() => {
    load();
    const id = window.setInterval(load, REFRESH_MS);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? "cc.morning" : hour < 18 ? "cc.afternoon" : "cc.evening", { name: me?.first_name || "" });
  const actions = useMemo(
    () =>
      [
        can.leads && { to: "/admin/leads", icon: UserPlus, label: t("cc.qa.leads") },
        can.projects && { to: "/admin/calendar", icon: CalendarPlus, label: t("cc.qa.appointment") },
        can.projects && { to: "/admin/projects", icon: FolderKanban, label: t("cc.qa.projects") },
        can.campaigns && { to: "/admin/campaigns", icon: Megaphone, label: t("cc.qa.campaign") },
        can.events && { to: "/admin/events", icon: CalendarClock, label: t("cc.qa.events") },
        can.finance && { to: "/admin/billing", icon: CreditCard, label: t("cc.qa.billing") },
      ].filter(Boolean) as { to: string; icon: LucideIcon; label: string }[],
    [can.leads, can.projects, can.campaigns, can.events, can.finance, t],
  );
  const total = data?.inbox.reduce((n, i) => n + i.count, 0) ?? 0;
  const tr = data?.trends;
  const sum = (k: "leads" | "clients" | "affiliates" | "contractors", last = 4) =>
    (tr?.weeks ?? []).slice(-last).reduce((n, w) => n + w[k], 0);

  return (
    <div className="portal-page gw-cc">
      <PageMeta title={t("cc.title")} description={t("cc.title")} noIndex />
      <header className="gw-cc__hero">
        <div className="gw-cc__hello">
          <p className="gw-cc__date">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
          <h1>{greeting}</h1>
          <p className="gw-cc__summary">
            {data ? (total ? t("cc.summary", { count: total }) : t("cc.allClear")) : t("cc.loading")}
          </p>
        </div>
        <div className="gw-cc__tools">
          <div className="gw-seg" role="radiogroup" aria-label={t("cc.scope")}>
            {[false, true].map((m) => (
              <button key={String(m)} type="button" role="radio" aria-checked={mine === m} className={cn(mine === m && "is-on")} onClick={() => setMine(m)}>
                {t(m ? "cc.mine" : "cc.everyone")}
              </button>
            ))}
          </div>
          <button type="button" className="gw-cc__refresh" onClick={load} aria-label={t("cc.refresh")} title={t("cc.refresh")}>
            <RefreshCw size={16} className={cn(loading && "spin")} aria-hidden />
          </button>
        </div>
        {actions.length ? (
          <nav className="gw-cc__actions" aria-label={t("cc.quickActions")}>
            {actions.map((a) => (
              <Link key={a.to} to={a.to} className="gw-cc__action">
                <a.icon size={18} aria-hidden />
                <span>{a.label}</span>
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <ErrorNote error={error} />

      <div className="gw-cc__grid">
        <section className="gw-cc__card gw-cc__inbox" aria-labelledby="cc-inbox">
          <h2 id="cc-inbox">
            <Sparkles size={17} aria-hidden /> {t("cc.needsYou")}
          </h2>
          {!data ? (
            <Skeleton rows={4} />
          ) : data.inbox.length ? (
            <ul>
              {data.inbox.map((i) => {
                const Icon = INBOX_ICON[i.key] || Inbox;
                return (
                  <li key={i.key}>
                    <Link to={i.to} className={cn("gw-cc__task", `is-${i.tone}`)}>
                      <span className="gw-cc__task-icon" aria-hidden>
                        <Icon size={18} />
                      </span>
                      <span className="gw-cc__task-text">
                        <strong>{t(`cc.inbox.${i.key}`, { count: i.count })}</strong>
                        {i.amount_cents ? <small>{fmt.money(i.amount_cents)}</small> : <small>{t(`cc.inboxHint.${i.key}`)}</small>}
                      </span>
                      <span className="gw-cc__task-count">{i.count}</span>
                      <ArrowRight size={16} className="gw-cc__task-go" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="gw-cc__clear">
              <CheckCircle2 size={20} aria-hidden /> {t("cc.allClearLong")}
            </p>
          )}
        </section>

        {can.projects ? (
          <section className="gw-cc__card" aria-labelledby="cc-today">
            <h2 id="cc-today">
              <CalendarClock size={17} aria-hidden /> {t("cc.today")}
            </h2>
            {!data ? (
              <Skeleton rows={3} />
            ) : data.appointments.length ? (
              <ol className="gw-cc__agenda">
                {data.appointments.map((a) => (
                  <li key={a.id}>
                    <time>{a.starts_at ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(a.starts_at)) : ""}</time>
                    <div>
                      <strong>{a.title}</strong>
                      <small>
                        {t(`appt.kind.${a.kind}`, { defaultValue: a.kind })}
                        {a.owner ? ` · ${a.owner}` : ""}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="pf-muted">{t("cc.noAppointments")}</p>
            )}
            <Link className="gw-cc__more" to="/admin/calendar">
              {t("cc.openCalendar")} <ArrowRight size={14} aria-hidden />
            </Link>
          </section>
        ) : null}

        {tr ? (
          <section className="gw-cc__card gw-cc__kpis" aria-labelledby="cc-pulse">
            <h2 id="cc-pulse">
              <TrendingUp size={17} aria-hidden /> {t("cc.pulse")}
            </h2>
            <div className="gw-cc__kpi-grid">
              {(["leads", "clients", "affiliates", "contractors"] as const).map((k) => (
                <div key={k} className="gw-cc__kpi">
                  <span>{t(`cc.kpi.${k}`)}</span>
                  <strong>{sum(k)}</strong>
                  <Sparkline values={tr.weeks.map((w) => w[k])} label={t(`cc.kpi.${k}`)} />
                  <small>{t("cc.last4w")}</small>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {data?.money ? (
          <section className="gw-cc__card gw-cc__money" aria-labelledby="cc-money">
            <h2 id="cc-money">
              <Banknote size={17} aria-hidden /> {t("cc.money")}
            </h2>
            <div className="gw-cc__money-top">
              <div>
                <span>{t("billAdmin.mrr")}</span>
                <strong>{fmt.money(data.money.mrr_cents)}</strong>
              </div>
              <div>
                <span>{t("cc.netClosed")}</span>
                <strong>{fmt.money(data.money.closed.net_cents)}</strong>
                <small>{t("cc.closedCount", { count: data.money.closed.count })}</small>
              </div>
            </div>
            <h3>{t("cc.pipeline")}</h3>
            <HBars
              tone="gold"
              rows={data.money.pipeline.map((p) => ({ label: `${t(`milestone.${p.milestone}`)} · ${p.count}`, value: p.value_cents }))}
              format={(v) => fmt.money(v)}
            />
            <h3>{t("cc.commissions")}</h3>
            <div className="gw-cc__chips">
              {(["pending", "approved", "paid"] as const).map((k) => (
                <Link key={k} to="/admin/commissions" className="gw-cc__chip">
                  <span>{t(`cc.com.${k}`)}</span>
                  <b>{fmt.money(data.money!.commissions[k])}</b>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {tr ? (
          <section className="gw-cc__card gw-cc__trends" aria-labelledby="cc-trends">
            <h2 id="cc-trends">
              <TrendingUp size={17} aria-hidden /> {t("cc.trends")}
            </h2>
            <WeeklyBars
              label={t("cc.trendsAria")}
              weeks={tr.weeks}
              series={[
                { key: "leads", label: t("cc.kpi.leads"), color: "#0e2a4a", values: tr.weeks.map((w) => w.leads) },
                { key: "clients", label: t("cc.kpi.clients"), color: "#d4a548", values: tr.weeks.map((w) => w.clients) },
                { key: "contracted", label: t("milestone.contracted"), color: "#1f4a3a", values: tr.weeks.map((w) => w.contracted) },
              ]}
            />
            <div className="gw-cc__split">
              <div>
                <h3>{t("cc.funnel")}</h3>
                <HBars
                  rows={(["leads", "clients", "contracted", "closed"] as const).map((k, i, all) => {
                    const v = tr.funnel[k];
                    const prev = i ? tr.funnel[all[i - 1]] : 0;
                    return { label: t(`cc.funnelStep.${k}`), value: v, hint: i && prev ? t("cc.conversion", { pct: Math.round((v / prev) * 100) }) : undefined };
                  })}
                />
              </div>
              <div>
                <h3>{t("cc.sources")}</h3>
                {tr.sources.length ? <HBars rows={tr.sources.map((s) => ({ label: s.source, value: s.count }))} /> : <p className="pf-muted">—</p>}
              </div>
            </div>
            {tr.events.length ? (
              <>
                <h3>{t("cc.events")}</h3>
                <HBars tone="gold" rows={tr.events.map((e) => ({ label: `${e.title}${e.starts_at ? ` · ${fmt.date(e.starts_at)}` : ""}`, value: e.rsvps }))} />
              </>
            ) : null}
          </section>
        ) : null}

        {data?.activity.length ? (
          <section className="gw-cc__card gw-cc__feed" aria-labelledby="cc-feed">
            <h2 id="cc-feed">
              <Activity size={17} aria-hidden /> {t("cc.activity")}
              <span className="gw-cc__live" aria-hidden>
                <i /> {t("cc.live")}
              </span>
            </h2>
            <ol>
              {data.activity.map((a, i) => {
                const Icon = ACT_ICON[a.kind] || (a.kind.startsWith("billing") ? CreditCard : a.kind.startsWith("draw") ? Wallet : Activity);
                const body = (
                  <>
                    <span className="gw-cc__feed-icon" aria-hidden>
                      <Icon size={15} />
                    </span>
                    <span className="gw-cc__feed-text">
                      <strong>{t(`cc.act.${a.kind}`, { defaultValue: a.kind, name: a.title, detail: a.detail ? t(`milestone.${a.detail}`, { defaultValue: a.detail }) : "" })}</strong>
                      <small>{fmt.relative ? fmt.relative(a.at) : fmt.date(a.at)}</small>
                    </span>
                  </>
                );
                return <li key={`${a.kind}-${a.at}-${i}`}>{a.to ? <Link to={a.to}>{body}</Link> : <div>{body}</div>}</li>;
              })}
            </ol>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="gw-skel" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
