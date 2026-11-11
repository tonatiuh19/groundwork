import { useEffect, useState } from "react";
import { BadgeCheck, Plus, Printer, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CityDetail } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addCityActivity, addCityContact, deleteCityActivity, deleteCityContact, fetchCityDetail, saveCityIntel, updateCity, verifyCityIntel, type CityScope } from "@/store/slices/cityPartnerSlice";
import { BusyButton, ErrorNote, SegmentedTabs } from "@/components/portal/kit";
import { ACTIVITY_TYPES, CITY_LEVELS, CITY_STAGES, FollowUpBadge, JOURNEY, journeyIndex } from "@/components/city/CityBits";
import CityPrint, { type CityPrintKind } from "@/components/city/CityPrint";
import { Celebrate, JourneyTracker, KitSkeleton } from "@/components/partnerKit/PartnerKit";
import { useFormatters } from "@/lib/format";
import { CityMeetingsPanel } from "@/components/city/CityPartnerRequests";
import CityAppointmentsPanel from "@/components/city/CityAppointmentsPanel";

type Tab = "pipeline" | "activity" | "intel" | "meetings";
const today = () => new Date().toISOString().slice(0, 10);

function PipelineForm({ scope, d }: { scope: CityScope; d: CityDetail }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const saving = useAppSelector((s) => s.cityPartner.saving);
  const c = d.city;
  const [f, setF] = useState(() => ({ ...c, review_round: c.review_round == null ? "" : String(c.review_round) }));
  useEffect(() => setF({ ...c, review_round: c.review_round == null ? "" : String(c.review_round) }), [c]);
  const val = (k: keyof typeof f) => (f[k] == null ? "" : String(f[k]));
  const on = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const date = (k: keyof typeof f, labelKey: string) => (
    <label className="pf-field">
      <span>{t(labelKey)}</span>
      <input type="date" value={val(k)} onChange={on(k)} />
    </label>
  );
  return (
    <form
      className="pf-form"
      onSubmit={(e) => {
        e.preventDefault();
        const body: Record<string, unknown> = {
          pipeline_stage: f.pipeline_stage || null,
          priority: f.priority,
          interest: f.interest,
          county: f.county || "",
          next_action: f.next_action || "",
          next_action_on: f.next_action_on || "",
          plan_set: f.plan_set || "",
          submitted_on: f.submitted_on || "",
          review_round: f.review_round,
          comments_on: f.comments_on || "",
          resubmitted_on: f.resubmitted_on || "",
          pipeline_notes: f.pipeline_notes || "",
        };
        if (scope === "admin") body.opened_on = f.opened_on || "";
        void dispatch(updateCity({ scope, id: c.id, body }));
      }}
    >
      <div className="pf-form-grid">
        <label className="pf-field">
          <span>{t("cityPartner.stageLabel")}</span>
          <select value={val("pipeline_stage")} onChange={on("pipeline_stage")}>
            <option value="" disabled={scope === "city"}>{t("cityPartner.stage.none")}</option>
            {CITY_STAGES.map((s) => (
              <option key={s} value={s} disabled={scope === "city" && s === "preapproved" && c.pipeline_stage !== "preapproved"}>
                {t(`cityPartner.stage.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {(["priority", "interest"] as const).map((k) => (
          <label key={k} className="pf-field">
            <span>{t(`cityPartner.${k}`)}</span>
            <select value={val(k)} onChange={on(k)}>
              {CITY_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`cityPartner.level.${l}`)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="pf-field">
          <span>{t("cityPartner.county")}</span>
          <input value={val("county")} maxLength={100} onChange={on("county")} />
        </label>
      </div>
      {scope === "city" ? <p className="pf-hint">{t("cityPartner.preapprovedStaffOnly")}</p> : null}
      <div className="pf-form-grid">
        <label className="pf-field">
          <span>{t("cityPartner.nextAction")}</span>
          <input value={val("next_action")} maxLength={300} placeholder={t(`cityPartner.next.${c.suggested.key}`)} onChange={on("next_action")} />
        </label>
        {date("next_action_on", "cityPartner.nextActionOn")}
      </div>
      <div className="pf-form-grid">
        <label className="pf-field">
          <span>{t("cityPartner.planSet")}</span>
          <input value={val("plan_set")} maxLength={200} onChange={on("plan_set")} />
        </label>
        {date("submitted_on", "cityPartner.submittedOn")}
        <label className="pf-field">
          <span>{t("cityPartner.reviewRound")}</span>
          <input type="number" min={0} max={20} value={val("review_round")} onChange={on("review_round")} />
        </label>
        {date("comments_on", "cityPartner.commentsOn")}
        {date("resubmitted_on", "cityPartner.resubmittedOn")}
        {scope === "admin" ? date("opened_on", "cityPartner.openedOn") : null}
      </div>
      <label className="pf-field">
        <span>{t("cityPartner.notes")}</span>
        <textarea rows={3} maxLength={4000} value={val("pipeline_notes")} onChange={on("pipeline_notes")} />
      </label>
      <div className="pf-actions">
        <BusyButton type="submit" tone="gold" label={t("pf.save")} busy={saving} />
      </div>
    </form>
  );
}

function ActivityLog({ scope, d }: { scope: CityScope; d: CityDetail }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const saving = useAppSelector((s) => s.cityPartner.saving);
  const blank = { occurred_on: today(), activity_type: "call", contact_name: "", summary: "", next_step: "", follow_up_on: "", link_url: "" };
  const [f, setF] = useState(blank);
  const on = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <form
        className="pf-form gw-city-logform"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await dispatch(addCityActivity({ scope, id: d.city.id, body: f }));
          if (addCityActivity.fulfilled.match(r)) setF(blank);
        }}
      >
        <div className="pf-form-grid">
          <label className="pf-field">
            <span>{t("cityPartner.activity.date")}</span>
            <input type="date" value={f.occurred_on} onChange={on("occurred_on")} />
          </label>
          <label className="pf-field">
            <span>{t("cityPartner.activity.type")}</span>
            <select value={f.activity_type} onChange={on("activity_type")}>
              {ACTIVITY_TYPES.map((a) => (
                <option key={a} value={a}>
                  {t(`cityPartner.activityType.${a}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="pf-field">
            <span>{t("cityPartner.activity.contact")}</span>
            <input value={f.contact_name} maxLength={160} onChange={on("contact_name")} />
          </label>
        </div>
        <label className="pf-field">
          <span>{t("cityPartner.activity.summary")}</span>
          <textarea rows={2} maxLength={1000} value={f.summary} onChange={on("summary")} />
        </label>
        <div className="pf-form-grid">
          <label className="pf-field">
            <span>{t("cityPartner.activity.nextStep")}</span>
            <input value={f.next_step} maxLength={300} onChange={on("next_step")} />
          </label>
          <label className="pf-field">
            <span>{t("cityPartner.activity.followUp")}</span>
            <input type="date" value={f.follow_up_on} onChange={on("follow_up_on")} />
          </label>
          <label className="pf-field">
            <span>{t("cityPartner.activity.link")}</span>
            <input type="url" inputMode="url" placeholder="https://" value={f.link_url} maxLength={500} onChange={on("link_url")} />
          </label>
        </div>
        <div className="pf-actions">
          <BusyButton type="submit" tone="gold" icon={Plus} label={t("cityPartner.activity.add")} busy={saving} disabled={!f.summary.trim()} />
        </div>
      </form>
      {!d.activities.length ? <p className="pf-hint">{t("cityPartner.activity.empty")}</p> : null}
      <ul className="gw-mail-org__list">
        {d.activities.map((a) => (
          <li key={a.id}>
            <span className="gw-mail-org__main">
              <strong>
                {t(`cityPartner.activityType.${a.activity_type}`)} · {fmt.date(`${a.occurred_on}T12:00:00`)}
                {a.contact_name ? ` · ${a.contact_name}` : ""}
              </strong>
              <small>{a.summary}</small>
              {a.next_step || a.follow_up_on ? (
                <small>
                  {t("cityPartner.activity.nextStep")}: {a.next_step || ""}
                  {a.follow_up_on ? ` (${fmt.date(`${a.follow_up_on}T12:00:00`)})` : ""}
                </small>
              ) : null}
              {a.link_url ? (
                <a className="text-link" href={a.link_url} target="_blank" rel="noreferrer">
                  {t("cityPartner.activity.openLink")}
                </a>
              ) : null}
              {a.by_name ? <small>{a.by_name}</small> : null}
            </span>
            {a.mine ? (
              <button type="button" className="pf-icon-btn" aria-label={t("cityPartner.activity.delete")} onClick={() => void dispatch(deleteCityActivity({ scope, id: d.city.id, activityId: a.id }))}>
                <Trash2 size={14} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function IntelPanel({ scope, d }: { scope: CityScope; d: CityDetail }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const saving = useAppSelector((s) => s.cityPartner.saving);
  const [f, setF] = useState(() => ({ council_summary: d.intel?.council_summary || "", adu_program_status: d.intel?.adu_program_status || "unknown", adu_program_notes: d.intel?.adu_program_notes || "", intel_sources: d.intel?.intel_sources || "" }));
  const blankContact = { kind: "planning", name: "", title: "", email: "", phone: "" };
  const [ct, setCt] = useState(blankContact);
  useEffect(() => setF({ council_summary: d.intel?.council_summary || "", adu_program_status: d.intel?.adu_program_status || "unknown", adu_program_notes: d.intel?.adu_program_notes || "", intel_sources: d.intel?.intel_sources || "" }), [d.intel]);
  if (!d.intel) return <p className="pf-hint">{t("cityPartner.intel.pending")}</p>;
  const editable = scope === "admin";
  return (
    <div className="pf-form">
      {d.score ? (
        <div className="gw-city-score">
          <div className="gw-city-score__ring" style={{ ["--pct" as string]: `${d.score.score}%` }}>
            <strong>{d.score.score}%</strong>
          </div>
          <div>
            <p>
              <strong>{t("cityPartner.intel.complete")}</strong>
            </p>
            {d.score.missing.length ? <p className="pf-hint">{t("cityPartner.intel.missing", { items: d.score.missing.map((m) => t(`cityPartner.intelCheck.${m}`)).join(", ") })}</p> : <p className="pf-hint">{t("cityPartner.intel.allSet")}</p>}
            {d.score.stale_contacts ? <p className="pf-hint">{t("cityPartner.intel.stale", { count: d.score.stale_contacts })}</p> : null}
            {d.score.duplicates ? <p className="gw-qr-warn">{t("cityPartner.intel.duplicates", { count: d.score.duplicates })}</p> : null}
            <p className="pf-hint">{d.intel.intel_verified_at ? t("cityPartner.intel.verifiedOn", { date: fmt.date(d.intel.intel_verified_at) }) : t("cityPartner.intel.notVerified")}</p>
          </div>
        </div>
      ) : null}
      <label className="pf-field">
        <span>{t("cityPartner.intel.council")}</span>
        <textarea rows={3} maxLength={4000} readOnly={!editable} value={f.council_summary} onChange={(e) => setF({ ...f, council_summary: e.target.value })} />
      </label>
      <div className="pf-form-grid">
        <label className="pf-field">
          <span>{t("cityPartner.intel.aduStatus")}</span>
          <select disabled={!editable} value={f.adu_program_status} onChange={(e) => setF({ ...f, adu_program_status: e.target.value as typeof f.adu_program_status })}>
            {(["unknown", "none", "in_development", "active", "paused"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`cityPartner.adu.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="pf-field">
        <span>{t("cityPartner.intel.aduNotes")}</span>
        <textarea rows={2} maxLength={4000} readOnly={!editable} value={f.adu_program_notes} onChange={(e) => setF({ ...f, adu_program_notes: e.target.value })} />
      </label>
      <label className="pf-field">
        <span>{t("cityPartner.intel.sources")}</span>
        <textarea rows={2} maxLength={2000} readOnly={!editable} value={f.intel_sources} onChange={(e) => setF({ ...f, intel_sources: e.target.value })} />
      </label>
      {editable ? (
        <div className="pf-actions">
          <BusyButton tone="gold" label={t("pf.save")} busy={saving} onClick={() => void dispatch(saveCityIntel({ id: d.city.id, body: f }))} />
          <BusyButton icon={BadgeCheck} label={t("cityPartner.intel.verify")} busy={saving} onClick={() => void dispatch(verifyCityIntel(d.city.id))} />
        </div>
      ) : null}
      {editable ? <p className="pf-hint">{t("cityPartner.intel.editResets")}</p> : null}
      <h3 className="pf-h3">
        <Users size={16} aria-hidden /> {t("cityPartner.intel.contacts")}
      </h3>
      <ul className="gw-mail-org__list">
        {d.contacts.map((x) => (
          <li key={x.id}>
            <span className="gw-mail-org__main">
              <strong>
                {x.name}
                {x.title ? ` · ${x.title}` : ""}
              </strong>
              <small>
                {t(`cityPartner.contactKind.${x.kind}`)}
                {x.email ? ` · ${x.email}` : ""}
                {x.phone ? ` · ${x.phone}` : ""}
              </small>
            </span>
            {editable ? (
              <button type="button" className="pf-icon-btn" aria-label={t("cityPartner.intel.deleteContact", { name: x.name })} onClick={() => void dispatch(deleteCityContact({ id: d.city.id, contactId: x.id }))}>
                <Trash2 size={14} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <div className="pf-form-grid">
          <select value={ct.kind} aria-label={t("cityPartner.intel.contactKind")} onChange={(e) => setCt({ ...ct, kind: e.target.value })}>
            {(["elected", "planning", "building", "city_staff", "consultant"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`cityPartner.contactKind.${k}`)}
              </option>
            ))}
          </select>
          {(["name", "title", "email", "phone"] as const).map((k) => (
            <input key={k} value={ct[k]} placeholder={t(`cityPartner.intel.${k}`)} aria-label={t(`cityPartner.intel.${k}`)} onChange={(e) => setCt({ ...ct, [k]: e.target.value })} />
          ))}
          <BusyButton
            icon={Plus}
            label={t("cityPartner.intel.addContact")}
            busy={saving}
            disabled={!ct.name.trim()}
            onClick={async () => {
              const r = await dispatch(addCityContact({ id: d.city.id, body: ct }));
              if (addCityContact.fulfilled.match(r)) setCt(blankContact);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** One city: pipeline fields, activity log, city sheet, printable forms. Same screen for staff and partners. */
export default function CityDetailView({ scope, id }: { scope: CityScope; id: number }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const { detail, loading, error } = useAppSelector((s) => s.cityPartner);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [print, setPrint] = useState<CityPrintKind | null>(null);
  useEffect(() => {
    void dispatch(fetchCityDetail({ scope, id }));
  }, [dispatch, scope, id]);
  const d = detail && detail.city.id === id ? detail : null;
  if (loading && !d) return <KitSkeleton layout="detail" rows={4} />;
  if (!d) return <ErrorNote error={error} />;
  return (
    <div className="gw-city">
      <ErrorNote error={error} />
      {scope === "city" && d.city.opened_on ? (
        <Celebrate storageKey={`gw-city-opened-${d.city.id}`} title={t("cityPartner.celebrateTitle", { city: d.city.name })} text={t("cityPartner.celebrateText")} closeLabel={t("cityPartner.celebrateClose")} />
      ) : null}
      <section className="pf-card gw-city-hero">
        <div className="gw-city-card__head">
          <h2 className="pf-h2">{d.city.name}</h2>
          {d.city.opened_on ? <span className="gw-city-badge is-opened">{t("cityPartner.opened")}</span> : null}
          <FollowUpBadge city={d.city} />
        </div>
        <JourneyTracker
          paused={d.city.pipeline_stage === "on_hold"}
          currentIndex={d.city.opened_on ? JOURNEY.length : journeyIndex(d.city.pipeline_stage)}
          steps={JOURNEY.map((j) => {
            const reached = j.stages.map((st) => d.stage_dates?.[st]).filter(Boolean).sort()[0] || (j.key === "opened" ? d.city.opened_on : null);
            return { key: j.key, label: t(`cityPartner.journey.${j.key}`), date: reached ? fmt.date(reached.length === 10 ? `${reached}T12:00:00` : reached) : null };
          })}
        />
        {d.city.pipeline_stage === "on_hold" ? <p className="gw-qr-warn">{t("cityPartner.stage.on_hold")}</p> : null}
        <div className="gw-city-next">
          <span>{t("cityPartner.suggested")}</span>
          <strong>{d.city.next_action || t(`cityPartner.next.${d.city.suggested.key}`)}</strong>
        </div>
        <div className="gw-city-print-btns">
          {(["intel", "leave_behind", "agenda"] as const).map((k) => (
            <button key={k} type="button" className="pf-btn pf-btn--sm" onClick={() => setPrint(k)} disabled={k === "intel" && !d.intel}>
              <Printer size={14} aria-hidden /> {t(`cityPartner.print.${k}`)}
            </button>
          ))}
        </div>
      </section>
      <SegmentedTabs<Tab>
        value={tab}
        onChange={setTab}
        ariaLabel={t("cityPartner.tabsAria")}
        options={[
          { value: "pipeline", labelKey: "cityPartner.tabPipeline" },
          { value: "activity", labelKey: "cityPartner.tabActivity", count: d.activities.length || null },
          { value: "intel", labelKey: "cityPartner.tabIntel" },
          // Partners book meetings here and invite Groundwork staff (lands on their calendar).
          // Partners book meetings here; staff see every appointment tagged with the city (and schedule one).
          { value: "meetings" as const, labelKey: "cityPartner.tabMeetings" },
        ]}
      />
      <section className="pf-card">
        {tab === "pipeline" ? (
<PipelineForm scope={scope} d={d} />
        ) : null}
        {tab === "activity" ? <ActivityLog scope={scope} d={d} /> : null}
        {tab === "intel" ? (
<IntelPanel scope={scope} d={d} />
        ) : null}
        {tab === "meetings" && scope === "city" ? <CityMeetingsPanel cityId={d.city.id} cityName={d.city.name} /> : null}
        {tab === "meetings" && scope === "admin" ? <CityAppointmentsPanel cityId={d.city.id} /> : null}
      </section>
      {print ? <CityPrint kind={print} detail={d} onClose={() => setPrint(null)} /> : null}
    </div>
  );
}
