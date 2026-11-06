import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, Banknote, CalendarClock, FileSignature, Home, MapPinned } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchCityClients, fetchCityFees, fetchCityOverview } from "@/store/slices/cityPartnerSlice";
import { EmptyState, ErrorNote, Loading, PageHeader, StatCard } from "@/components/portal/kit";
import PortalLoginPage from "@/components/portal/PortalLoginPage";
import CityPipelineBoard from "@/components/city/CityPipelineBoard";
import CityDetailView from "@/components/city/CityDetailView";
import { FollowUpBadge, centsToMoney, monthShort } from "@/components/city/CityBits";
import { CityFeed, QuickLog } from "@/components/city/CityFeed";
import { EarningsChart, JourneyTracker, KitEmpty, KitSkeleton, PartnerHero } from "@/components/partnerKit/PartnerKit";
import { useFormatters } from "@/lib/format";
import { CityRequestPanel } from "@/components/city/CityPartnerRequests";

export function CityLogin() {
  return <PortalLoginPage actor="city" homePath="/city" />;
}

export function CityDashboard() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const user = useAppSelector((s) => s.portalAuth.city.user);
  const { overview: o, loading, error } = useAppSelector((s) => s.cityPartner);
  const load = () => void dispatch(fetchCityOverview());
  useEffect(load, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !o) return <div className="portal-page"><KitSkeleton rows={4} /></div>;
  if (!o) return <div className="portal-page"><ErrorNote error={error} /></div>;
  const needs = !o.onboarding.agreement ? "sign" : !o.onboarding.w9 || o.onboarding.w9.status === "rejected" ? "w9" : !o.onboarding.agreement.countersigned_at ? "countersign" : null;
  const followUps = o.cities.filter((c) => c.follow_up !== "none").sort((a, b) => (a.next_action_on || "").localeCompare(b.next_action_on || "")).slice(0, 5);
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? "cityPartner.hello.morning" : hour < 18 ? "cityPartner.hello.afternoon" : "cityPartner.hello.evening", { name: user?.first_name || "" });
  return (
    <div className="portal-page">
      <PartnerHero
        eyebrow={t("cityPartner.portalTitle")}
        title={greet}
        lead={o.kpis.overdue ? t("cityPartner.heroOverdue", { count: o.kpis.overdue }) : t("cityPartner.heroLead", { count: o.kpis.cities })}
        action={<QuickLog cities={o.cities} onLogged={load} />}
        stats={[
          { label: t("cityPartner.kpi.cities"), value: o.kpis.cities },
          { label: t("cityPartner.kpi.opened"), value: o.kpis.opened, tone: "green" },
          { label: t("cityPartner.kpi.feesPaid"), value: centsToMoney(o.fees.paid_cents) },
          { label: t("cityPartner.kpi.feesPending"), value: centsToMoney(o.fees.pending_cents), tone: "gold" },
        ]}
      />
      {needs ? (
        <Link to="/city/agreement" className="pf-card gw-city-cta">
          <FileSignature size={18} aria-hidden /> {t(`cityPartner.todo.${needs}`)}
        </Link>
      ) : null}
      <div className="pk-layout">
        <section className="pf-card">
          <h2 className="pk-card-title"><Activity size={18} aria-hidden /> {t("cityPartner.feed.title")}</h2>
          <CityFeed items={o.feed} />
        </section>
        <div className="pk-side">
          <section className="pf-card">
            <h2 className="pk-card-title"><CalendarClock size={18} aria-hidden /> {t("cityPartner.followUpsTitle")}</h2>
            {!followUps.length ? <p className="pf-hint">{t("cityPartner.noFollowUps")}</p> : null}
            <ul className="gw-mail-org__list">
              {followUps.map((c) => (
                <li key={c.id}>
                  <Link to={`/city/cities/${c.id}`} className="gw-mail-org__main">
                    <strong><MapPinned size={14} aria-hidden /> {c.name}</strong>
                    <small>{c.next_action || t(`cityPartner.next.${c.suggested.key}`)}{c.next_action_on ? ` · ${fmt.date(`${c.next_action_on}T12:00:00`)}` : ""}</small>
                  </Link>
                  <FollowUpBadge city={c} />
                </li>
              ))}
            </ul>
          </section>
          <section className="pf-card">
            <h2 className="pk-card-title"><Banknote size={18} aria-hidden /> {t("cityPartner.earningsTitle")}</h2>
            <EarningsChart data={o.earnings} money={centsToMoney} monthLabel={(ym) => monthShort(ym, i18n.language)} legend={{ paid: t("cityPartner.legendPaid"), coming: t("cityPartner.legendComing") }} />
            {o.fees.next_due_on ? <p className="pf-hint">{t("cityPartner.nextPayout", { date: fmt.date(`${o.fees.next_due_on}T12:00:00`) })}</p> : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export function CityCities() {
  return (
    <div className="portal-page">
      <PageHeader titleKey="cityPartner.navCities" leadKey="cityPartner.citiesLead" />
      <CityRequestPanel />
      <CityPipelineBoard scope="city" linkBase="/city/cities" />
    </div>
  );
}

export function CityCityDetail() {
  const id = Number(useParams().id);
  return (
    <div className="portal-page">
      <CityDetailView scope="city" id={id} />
    </div>
  );
}

const HOME_STEPS = ["lead", "financing", "contracted", "in_build", "closed"] as const;
export function CityClients() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { clients, loading, error } = useAppSelector((s) => s.cityPartner);
  useEffect(() => {
    void dispatch(fetchCityClients());
  }, [dispatch]);
  return (
    <div className="portal-page">
      <PageHeader titleKey="cityPartner.navClients" leadKey="cityPartner.clientsLead" />
      <ErrorNote error={error} />
      {loading && !clients.length ? <KitSkeleton layout="list" rows={3} /> : null}
      {!loading && !clients.length ? <section className="pf-card"><KitEmpty icon={Home} title={t("cityPartner.noClients")} text={t("cityPartner.noClientsText")} /></section> : null}
      <ul className="gw-city-cards">
        {clients.map((c) => (
          <li key={c.id} className="pf-card gw-city-card">
            <div className="gw-city-card__head">
              <strong><Home size={16} aria-hidden /> {c.name}</strong>
              {c.fee_status ? <span className="gw-city-badge is-upcoming">{centsToMoney(c.fee_cents || 0)} · {t(`cityPartner.feeStatus.${c.fee_status}`)}</span> : null}
            </div>
            <p className="pf-hint">{[c.street, c.city].filter(Boolean).join(", ")}{c.sq_ft ? ` · ${c.sq_ft} sq ft` : ""}</p>
            <JourneyTracker
              compact={false}
              paused={c.milestone === "cancelled"}
              currentIndex={c.milestone === "cancelled" ? -1 : HOME_STEPS.indexOf(c.milestone as (typeof HOME_STEPS)[number])}
              steps={HOME_STEPS.map((m) => ({ key: m, label: t(`milestone.${m}`) }))}
            />
            {c.milestone === "cancelled" ? <p className="gw-qr-warn">{t("milestone.cancelled")}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CityFees() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { fees, overview, loading, error } = useAppSelector((s) => s.cityPartner);
  useEffect(() => {
    void dispatch(fetchCityFees());
    void dispatch(fetchCityOverview());
  }, [dispatch]);
  const sum = (st: string[]) => fees.filter((f) => st.includes(f.status)).reduce((n, f) => n + f.amount_cents, 0);
  return (
    <div className="portal-page">
      <PageHeader titleKey="cityPartner.navFees" leadKey="cityPartner.feesLead" />
      <ErrorNote error={error} />
      <div className="pk-layout">
        <section className="pf-card">
          <h2 className="pk-card-title"><Banknote size={18} aria-hidden /> {t("cityPartner.earningsTitle")}</h2>
          {overview ? <EarningsChart data={overview.earnings} money={centsToMoney} monthLabel={(ym) => monthShort(ym, i18n.language)} legend={{ paid: t("cityPartner.legendPaid"), coming: t("cityPartner.legendComing") }} /> : <KitSkeleton layout="list" rows={1} />}
        </section>
        <div className="pk-side">
          <div className="pf-stats gw-city-kpis">
            <StatCard labelKey="cityPartner.kpi.feesPaid" value={centsToMoney(sum(["paid"]))} />
            <StatCard labelKey="cityPartner.kpi.feesPending" value={centsToMoney(sum(["pending", "approved"]))} tone="gold" hint={overview?.fees.next_due_on ? t("cityPartner.nextPayout", { date: fmt.date(`${overview.fees.next_due_on}T12:00:00`) }) : undefined} />
          </div>
        </div>
      </div>
      {loading && !fees.length ? <KitSkeleton layout="list" rows={3} /> : null}
      {!loading && !fees.length ? <section className="pf-card"><KitEmpty icon={Banknote} title={t("cityPartner.noFees")} text={t("cityPartner.noFeesText")} /></section> : null}
      {fees.length ? (
        <ul className="gw-mail-org__list pf-card">
          {fees.map((f) => (
            <li key={f.id}>
              <span className="gw-mail-org__main">
                <strong>{centsToMoney(f.amount_cents)} · {f.city_name}</strong>
                <small>{f.sq_ft} sq ft × {centsToMoney(f.rate_cents_per_sqft)} · {t("cityPartner.dueOn", { date: fmt.date(`${f.due_on}T12:00:00`) })}</small>
              </span>
              <span className={`gw-city-badge is-${f.status === "paid" ? "opened" : f.status === "void" || f.status === "refund_due" ? "overdue" : "upcoming"}`}>{t(`cityPartner.feeStatus.${f.status}`)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
