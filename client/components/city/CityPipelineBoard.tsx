import { useEffect, useState } from "react";
import { Download, MapPinned, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addPipelineCity, fetchCityList, type CityScope } from "@/store/slices/cityPartnerSlice";
import { fetchAdminCities } from "@/store/slices/citiesSlice";
import { EmptyState, ErrorNote, FilterSelect, ListPager, SearchBox, StatCard } from "@/components/portal/kit";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import CityCreateModal from "@/components/admin/CityCreateModal";
import { CITY_LEVELS, CITY_STAGES, FollowUpBadge, JOURNEY, journeyIndex } from "@/components/city/CityBits";
import { JourneyTracker, KitSkeleton } from "@/components/partnerKit/PartnerKit";
import { useFormatters } from "@/lib/format";

const PAGE = 24;

/** City tracker as a live, server-filtered grid: KPIs, follow-ups, search, filters, sort, pages. */
export default function CityPipelineBoard({ scope, linkBase }: { scope: CityScope; linkBase: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { list, loading, error } = useAppSelector((s) => s.cityPartner);
  const allCities = useAppSelector((s) => s.cities.adminList);
  const [f, setF] = useState({ q: "", stage: "", priority: "", follow_up: "", opened: "", sort: "name" });
  const [offset, setOffset] = useState(0);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const load = () => void dispatch(fetchCityList({ scope, ...f, limit: PAGE, offset }));
  useEffect(load, [dispatch, scope, f, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (scope === "admin") void dispatch(fetchAdminCities());
  }, [dispatch, scope]);
  const set = (k: keyof typeof f) => (v: string) => {
    setOffset(0);
    setF({ ...f, [k]: v });
  };
  const exportHref = `/api/${scope === "admin" ? "admin/city-pipeline" : "city/cities"}/export.csv?${new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()}`;
  const inPipeline = new Set((list?.cities || []).map((c) => c.id));
  const addToPipeline = async (id: number) => {
    await dispatch(addPipelineCity({ city_id: id }));
    void dispatch(fetchAdminCities());
    load();
  };

  return (
    <div className="gw-city">
      <ErrorNote error={error} />
      {list ? (
        <div className="pf-stats gw-city-kpis">
          <StatCard labelKey="cityPartner.kpi.cities" value={list.kpis.cities} />
          <StatCard labelKey="cityPartner.kpi.contacted" value={list.kpis.contacted} />
          <StatCard labelKey="cityPartner.kpi.meetings" value={list.kpis.meetings} />
          <StatCard labelKey="cityPartner.kpi.submitted" value={list.kpis.submitted} />
          <StatCard labelKey="cityPartner.kpi.opened" value={list.kpis.opened} tone="gold" />
          <StatCard labelKey="cityPartner.kpi.overdue" value={list.kpis.overdue} tone={list.kpis.overdue ? "alert" : undefined} hint={t("cityPartner.kpi.dueToday", { count: list.kpis.due_today })} />
        </div>
      ) : null}
      {scope === "admin" ? (
        <div className="pf-card">
          <MultiSearchPicker
            icon={Plus}
            label={t("cityPartner.addCity")}
            items={allCities.filter((c) => !inPipeline.has(c.id)).map((c) => ({ id: c.id, label: c.name }))}
            selected={[]}
            empty={t("cityPartner.allInPipeline")}
            placeholder={t("cityPartner.addCityPh")}
            onToggle={(id) => void addToPipeline(id)}
            onCreate={(q) => setQuickAdd(q)}
            createLabel={(q) => (q ? t("cities.addNamed", { name: q }) : t("cities.createNew"))}
            manageHref="/admin/settings#cities"
            manageLabel={t("cities.manage")}
          />
        </div>
      ) : null}
      <div className="pf-filters">
        <SearchBox onSearch={set("q")} />
        <FilterSelect value={f.stage} onChange={set("stage")} ariaLabel={t("cityPartner.stageLabel")} allLabel={t("cityPartner.filterAllStages")} options={CITY_STAGES.map((s) => ({ value: s, label: t(`cityPartner.stage.${s}`) }))} />
        <FilterSelect value={f.priority} onChange={set("priority")} ariaLabel={t("cityPartner.priority")} allLabel={t("cityPartner.filterAllPriorities")} options={CITY_LEVELS.map((l) => ({ value: l, label: t(`cityPartner.level.${l}`) }))} />
        <FilterSelect value={f.follow_up} onChange={set("follow_up")} ariaLabel={t("cityPartner.filterFollowUp")} allLabel={t("cityPartner.filterAnyFollowUp")} options={(["overdue", "due_today", "upcoming"] as const).map((v) => ({ value: v, label: t(`cityPartner.followUp.${v}`) }))} />
        <FilterSelect value={f.opened} onChange={set("opened")} ariaLabel={t("cityPartner.opened")} allLabel={t("cityPartner.filterAnyOpened")} options={[{ value: "yes", label: t("cityPartner.opened") }, { value: "no", label: t("cityPartner.notOpened") }]} />
        <FilterSelect value={f.sort === "name" ? "" : f.sort} onChange={(v) => set("sort")(v || "name")} ariaLabel={t("cityPartner.sortBy")} allLabel={t("cityPartner.sort.name")} options={(["next_action", "stage", "last_activity"] as const).map((v) => ({ value: v, label: t(`cityPartner.sort.${v}`) }))} />
        <a className="pf-btn pf-btn--sm" href={exportHref}>
          <Download size={14} aria-hidden /> {t("cityPartner.exportCsv")}
        </a>
      </div>
      {loading && !list ? <KitSkeleton layout="cards" rows={6} /> : null}
      {list && !list.cities.length ? <EmptyState messageKey={scope === "admin" ? "cityPartner.emptyAdmin" : "cityPartner.emptyPartner"} /> : null}
      <ul className="gw-city-cards">
        {list?.cities.map((c) => (
          <li key={c.id}>
            <Link to={`${linkBase}/${c.id}`} className="pf-card gw-city-card">
              <div className="gw-city-card__head">
                <strong>
                  <MapPinned size={16} aria-hidden /> {c.name}
                </strong>
                {c.opened_on ? <span className="gw-city-badge is-opened">{t("cityPartner.opened")}</span> : null}
                <FollowUpBadge city={c} />
              </div>
              <div className="gw-city-card__journey">
                <span>{c.pipeline_stage ? t(`cityPartner.stage.${c.pipeline_stage}`) : t("cityPartner.stage.none")}</span>
                <JourneyTracker compact paused={c.pipeline_stage === "on_hold"} currentIndex={c.opened_on ? JOURNEY.length : journeyIndex(c.pipeline_stage)} steps={JOURNEY.map((j) => ({ key: j.key, label: t(`cityPartner.journey.${j.key}`) }))} />
              </div>
              <dl className="gw-city-card__meta">
                <div>
                  <dt>{t("cityPartner.priority")}</dt>
                  <dd>{t(`cityPartner.level.${c.priority}`)}</dd>
                </div>
                <div>
                  <dt>{t("cityPartner.interest")}</dt>
                  <dd>{t(`cityPartner.level.${c.interest}`)}</dd>
                </div>
                <div>
                  <dt>{t("cityPartner.lastActivity")}</dt>
                  <dd>{c.last_activity_on ? fmt.date(`${c.last_activity_on}T12:00:00`) : t("cityPartner.never")}</dd>
                </div>
              </dl>
              <p className="gw-city-card__next">
                {c.next_action ? c.next_action : t(`cityPartner.next.${c.suggested.key}`)}
                {c.next_action_on ? ` · ${fmt.date(`${c.next_action_on}T12:00:00`)}` : ""}
              </p>
              {c.suggested.stale ? <p className="gw-qr-warn">{t("cityPartner.quiet")}</p> : null}
              {scope === "admin" && c.partners ? <p className="pf-hint">{t("cityPartner.partnersOn", { names: c.partners })}</p> : null}
            </Link>
          </li>
        ))}
      </ul>
      {list ? <ListPager total={list.total} limit={PAGE} offset={offset} onPageChange={setOffset} loading={loading} /> : null}
      <CityCreateModal initialName={quickAdd} onClose={() => setQuickAdd(null)} onPicked={(id) => void addToPipeline(id)} />
    </div>
  );
}
