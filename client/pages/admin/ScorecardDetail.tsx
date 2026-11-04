import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CalendarOff,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  MessageSquarePlus,
  Phone,
  PhoneMissed,
  PhoneOff,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserCheck,
  UserMinus,
  Voicemail,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScorecardAction, ScorecardActivityInput, ScorecardDetail as Detail, ScorecardKind, ScorecardSubjectType } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addScorecardNote,
  addScorecardTimeOff,
  assignScorecardLead,
  clearLeadHits,
  deleteScorecardActivity,
  deleteScorecardTimeOff,
  fetchScorecardDetail,
  logScorecardActivity,
  searchScorecardLeads,
  setScorecardRoles,
  updateScorecardAction,
} from "@/store/slices/scorecardsSlice";
import { BackLink, BusyButton, EmptyState, ErrorNote, Modal, PageHeader, SegmentedTabs } from "@/components/portal/kit";
import { ScorecardDetailSkeleton } from "@/components/scorecard/ScorecardSkeleton";
import { MetricBar, ScoreRing, StreakStrip, TrendChart, weekLabel } from "@/components/scorecard/ScorecardCharts";
import { ScorecardRules } from "@/components/scorecard/ScorecardRules";
import ProjectTrackingPanel, { todayKey } from "@/components/scorecard/ProjectTrackingPanel";
import { ActionKindBadge, initials } from "@/pages/admin/Scorecards";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

type Card = Detail["cards"][number];

/** One scorecard: ring + trend (click a week) + metric bars + what counted that week. */
function CardPanel({ card }: { card: Card }) {
  const { t, i18n } = useTranslation();
  const weeks = card.weeks;
  const [sel, setSel] = useState<string>(weeks[weeks.length - 1]?.week_start || "");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!weeks.some((w) => w.week_start === sel)) setSel(weeks[weeks.length - 1]?.week_start || "");
  }, [weeks, sel]);
  const week = weeks.find((w) => w.week_start === sel) || weeks[weeks.length - 1];
  const prev = week ? weeks[weeks.indexOf(week) - 1] : undefined;
  const delta = week?.score != null && prev?.score != null ? Math.round(week.score - prev.score) : null;
  const metric = week?.metrics.find((m) => m.key === open);
  if (!week) return <EmptyState messageKey="scorecards.noWeeks" />;
  return (
    <section className={cn("pf-card sc-cardpanel", `is-${week.color}`)}>
      <div className="sc-cardpanel__head">
        <ScoreRing score={week.score} grade={week.grade} color={week.color} size={148} stroke={13} />
        <div className="sc-cardpanel__summary">
          <p className="pf-kicker">{t(`scorecards.card_${card.scorecard}`)}</p>
          <h2>
            {week.score == null ? t("scorecards.notGraded") : t("scorecards.points", { n: Math.round(week.score) })}
            {delta != null ? <span className={cn("sc-delta", delta >= 0 ? "is-up" : "is-down")}>{delta >= 0 ? `+${delta}` : delta}</span> : null}
          </h2>
          <p className="pf-muted">
            {t("scorecards.weekOf", { date: weekLabel(week.week_start, i18n.language, true) })} · {week.final ? t("scorecards.frozen") : t("scorecards.live")}
          </p>
          <span className={cn("sc-status", `is-${week.color}`)}>
            {week.termination_review ? <ShieldAlert size={14} aria-hidden /> : null}
            {week.termination_review ? t("scorecards.ladder_term_t") : t(`scorecards.color_${week.color}`)}
          </span>
          <StreakStrip points={weeks.slice(-8)} lang={i18n.language} />
        </div>
      </div>
      <TrendChart points={weeks} selected={week.week_start} onSelect={setSel} />
      <div className="sc-metrics">
        {week.metrics.map((m) => (
          <MetricBar key={m.key} metric={m} active={open === m.key} onClick={() => setOpen(open === m.key ? null : m.key)} />
        ))}
      </div>
      {metric ? (
        <div className="sc-drill">
          <h3>{t(`scorecards.m_${metric.key}`)}</h3>
          <p className="pf-hint">{t(`scorecards.goal_${metric.key}`)}</p>
          {metric.items?.length ? (
            <ul>
              {metric.items.map((it, i) => (
                <li key={`${it.ref}${i}`} className={it.ok == null ? "is-pending" : it.ok ? "is-ok" : "is-miss"}>
                  {it.ok == null ? <CircleDashed size={15} aria-hidden /> : it.ok ? <CheckCircle2 size={15} aria-hidden /> : <XCircle size={15} aria-hidden />}
                  <span>{it.label || t("scorecards.untitled")}</span>
                  {it.detail ? <small>{it.detail}</small> : null}
                  <em>{it.ok == null ? t("scorecards.pending") : it.ok ? t("scorecards.met") : t("scorecards.missed")}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pf-muted">{t("scorecards.nothingDue")}</p>
          )}
        </div>
      ) : (
        <p className="pf-hint sc-drill-hint">{t("scorecards.tapMetric")}</p>
      )}
    </section>
  );
}

/** Open / closed follow-ups; meetings and warnings close only with the written record. */
function ActionItem({ a }: { a: ScorecardAction }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const [text, setText] = useState(a.resolution || "");
  const [busy, setBusy] = useState(false);
  const needsRecord = a.kind !== "coaching_note" && a.kind !== "note";
  const coach = a.auto && a.body ? a.body.split(",").filter(Boolean) : [];
  const save = async (status?: "done" | "open") => {
    setBusy(true);
    await dispatch(updateScorecardAction({ id: a.id, resolution: text, status }));
    setBusy(false);
  };
  return (
    <li className={cn("sc-action", `sc-action--${a.kind}`, a.status === "done" && "is-done")}>
      <div className="sc-action__head">
        <ActionKindBadge kind={a.kind} />
        <span className="pf-muted">
          {t(`scorecards.card_${a.scorecard}`)} · {t("scorecards.weekOf", { date: weekLabel(a.week_start, i18n.language) })}
        </span>
        <span className={cn("sc-action__state", a.status === "done" && "is-done")}>{a.status === "done" ? t("scorecards.done") : t("scorecards.open")}</span>
      </div>
      {a.auto ? (
        <div className="sc-action__body">
          <p>{t(`scorecards.auto_${a.kind}`)}</p>
          {coach.length ? (
            <ul className="sc-coach">
              {coach.map((k) => (
                <li key={k}>
                  <Sparkles size={13} aria-hidden />
                  <span>
                    <b>{t(`scorecards.m_${k}`)}:</b> {t(`scorecards.coach_${k}`)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : a.body ? (
        <p className="sc-action__body">{a.body}</p>
      ) : null}
      {a.kind !== "note" ? (
        <>
          <textarea
            value={text}
            rows={2}
            maxLength={8000}
            placeholder={t(needsRecord ? "scorecards.resolutionPh" : "scorecards.coachPh")}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("scorecards.resolution")}
          />
          <div className="pf-actions">
            {a.status === "open" ? (
              <BusyButton tone="gold" label={t("scorecards.markDone")} busy={busy} disabled={needsRecord && !text.trim()} onClick={() => void save("done")} />
            ) : (
              <BusyButton label={t("scorecards.reopen")} busy={busy} onClick={() => void save("open")} />
            )}
            {text.trim() !== (a.resolution || "") ? <BusyButton label={t("pf.save")} busy={busy} onClick={() => void save()} /> : null}
          </div>
        </>
      ) : null}
      <small className="pf-muted">
        {a.auto ? t("scorecards.autoBy") : a.created_by || ""} · {fmt.relative(a.created_at)}
        {a.completed_at ? ` · ${t("scorecards.closedBy", { who: a.completed_by || "-", when: fmt.relative(a.completed_at) })}` : ""}
      </small>
    </li>
  );
}

/** Lead rep work: the contractor's leads with one-tap call / contact / next step logging. */
function LeadsPanel({ d }: { d: Detail }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const hits = useAppSelector((s) => s.scorecards.leadHits);
  const [q, setQ] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const who = { type: d.subject.type, id: d.subject.id };
  const refresh = () => dispatch(fetchScorecardDetail(who));

  useEffect(() => {
    if (q.trim().length < 2) {
      dispatch(clearLeadHits());
      return;
    }
    const h = setTimeout(() => void dispatch(searchScorecardLeads(q.trim())), 300);
    return () => clearTimeout(h);
  }, [q, dispatch]);

  const log = async (key: string, body: ScorecardActivityInput) => {
    setBusy(key);
    const r = await dispatch(logScorecardActivity({ ...who, body }));
    setBusy(null);
    if (logScorecardActivity.fulfilled.match(r)) {
      setNoteFor(null);
      setNote("");
      void refresh();
    }
  };
  const lastBy = (leadId: number) => d.activities.filter((a) => a.lead_id === leadId);

  return (
    <section className="pf-card sc-work">
      <div className="pf-card-top">
        <div>
          <p className="pf-kicker">{t("scorecards.card_lead_rep")}</p>
          <h2>{t("scorecards.leadsTitle")}</h2>
        </div>
        <BusyButton icon={Plus} label={t("scorecards.assignLead")} onClick={() => setAssignOpen(true)} />
      </div>
      {!d.leads.length ? <p className="pf-muted">{t("scorecards.noLeads")}</p> : null}
      <ul className="sc-leads">
        {d.leads.map((l) => {
          const acts = lastBy(l.id);
          const calls = acts.filter((a) => a.kind === "call_attempt");
          const contacted = acts.some((a) => a.kind === "contacted" || a.outcome === "answered");
          const hasNext = acts.some((a) => a.kind === "next_step");
          return (
            <li key={l.id} className="sc-lead">
              <div className="sc-lead__who">
                <strong>{l.name}</strong>
                <small>
                  {l.phone || l.email || ""}
                  {l.assigned_at ? ` · ${t("scorecards.assignedAgo", { when: fmt.relative(l.assigned_at) })}` : ""}
                </small>
                <span className="sc-lead__chips">
                  <span className={cn("sc-chip", calls.length && "is-on")}>
                    <Phone size={12} aria-hidden /> {t("scorecards.callsN", { n: calls.length })}
                  </span>
                  <span className={cn("sc-chip", contacted && "is-on")}>
                    <UserCheck size={12} aria-hidden /> {t("scorecards.contacted")}
                  </span>
                  <span className={cn("sc-chip", hasNext && "is-on")}>
                    <ClipboardList size={12} aria-hidden /> {t("scorecards.nextStep")}
                  </span>
                </span>
              </div>
              <div className="sc-lead__acts">
                <button type="button" className="pf-btn pf-btn--sm" disabled={!!busy} onClick={() => void log(`a${l.id}`, { kind: "call_attempt", outcome: "answered", lead_id: l.id })}>
                  <Phone size={14} aria-hidden /> {t("scorecards.o_answered")}
                </button>
                <button type="button" className="pf-btn pf-btn--sm" disabled={!!busy} onClick={() => void log(`n${l.id}`, { kind: "call_attempt", outcome: "no_answer", lead_id: l.id })}>
                  <PhoneMissed size={14} aria-hidden /> {t("scorecards.o_no_answer")}
                </button>
                <button type="button" className="pf-btn pf-btn--sm" disabled={!!busy} onClick={() => void log(`v${l.id}`, { kind: "call_attempt", outcome: "voicemail", lead_id: l.id })}>
                  <Voicemail size={14} aria-hidden /> {t("scorecards.o_voicemail")}
                </button>
                <button type="button" className="pf-btn pf-btn--sm" disabled={!!busy} onClick={() => void log(`c${l.id}`, { kind: "contacted", lead_id: l.id })}>
                  <UserCheck size={14} aria-hidden /> {t("scorecards.contactedOther")}
                </button>
                <button type="button" className="pf-btn pf-btn--sm pf-btn--gold" onClick={() => setNoteFor(noteFor === l.id ? null : l.id)}>
                  <ClipboardList size={14} aria-hidden /> {t("scorecards.nextStep")}
                </button>
                <button
                  type="button"
                  className="pf-icon-btn"
                  aria-label={t("scorecards.unassign")}
                  title={t("scorecards.unassign")}
                  onClick={async () => {
                    await dispatch(assignScorecardLead({ leadId: l.id, contractorId: null }));
                    void refresh();
                  }}
                >
                  <UserMinus size={15} />
                </button>
              </div>
              {noteFor === l.id ? (
                <div className="sc-lead__note">
                  <textarea rows={2} maxLength={4000} value={note} placeholder={t("scorecards.nextStepPh")} onChange={(e) => setNote(e.target.value)} aria-label={t("scorecards.nextStep")} />
                  <BusyButton tone="gold" label={t("scorecards.saveNextStep")} busy={busy === `s${l.id}`} disabled={!note.trim()} onClick={() => void log(`s${l.id}`, { kind: "next_step", lead_id: l.id, note: note.trim() })} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Modal
        open={assignOpen}
        titleKey="scorecards.assignLead"
        onClose={() => {
          setAssignOpen(false);
          setQ("");
        }}
      >
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("scorecards.searchLead")}</span>
            <span className="sc-search">
              <Search size={15} aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("scorecards.searchLeadPh")} autoFocus />
            </span>
          </label>
          <p className="pf-hint">{t("scorecards.assignHint")}</p>
          <ul className="sc-hits">
            {hits.map((h) => (
              <li key={h.id}>
                <span>
                  <strong>{h.name}</strong>
                  <small>
                    {h.phone || h.email || ""}
                    {h.contractor_name ? ` · ${t("scorecards.withContractor", { name: h.contractor_name })}` : ""}
                  </small>
                </span>
                <BusyButton
                  tone="gold"
                  label={h.contractor_id === d.subject.id ? t("scorecards.assigned") : t("scorecards.assign")}
                  disabled={h.contractor_id === d.subject.id}
                  onClick={async () => {
                    await dispatch(assignScorecardLead({ leadId: h.id, contractorId: d.subject.id }));
                    setAssignOpen(false);
                    setQ("");
                    void refresh();
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </section>
  );
}

/** Days off (skipped by every clock). */
function TimeOffPanel({ d }: { d: Detail }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const [from, setFrom] = useState(todayKey());
  const [to, setTo] = useState(todayKey());
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const who = { type: d.subject.type, id: d.subject.id };
  return (
    <section className="pf-card sc-off">
      <h2 className="pf-h2">
        <CalendarOff size={18} aria-hidden /> {t("scorecards.timeOff")}
      </h2>
      <p className="pf-hint">{t("scorecards.timeOffHint")}</p>
      <ul className="sc-off__list">
        {d.time_off.map((o) => (
          <li key={o.id}>
            <span>
              <strong>{o.starts_on === o.ends_on ? fmt.date(`${o.starts_on}T12:00:00`) : `${fmt.date(`${o.starts_on}T12:00:00`)} - ${fmt.date(`${o.ends_on}T12:00:00`)}`}</strong>
              {o.label ? <small>{o.label}</small> : null}
            </span>
            <button
              type="button"
              className="pf-icon-btn"
              aria-label={t("scorecards.delete")}
              onClick={async () => {
                await dispatch(deleteScorecardTimeOff(o.id));
                void dispatch(fetchScorecardDetail(who));
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!d.time_off.length ? <li className="pf-muted">{t("scorecards.noTimeOff")}</li> : null}
      </ul>
      <div className="sc-off__add">
        <label className="sc-field">
          <span>{t("scorecards.from")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="sc-field">
          <span>{t("scorecards.to")}</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="sc-field sc-field--wide">
          <span>{t("scorecards.timeOffLabel")}</span>
          <input value={label} maxLength={160} placeholder={t("scorecards.timeOffPh")} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <BusyButton
          icon={Plus}
          label={t("scorecards.add")}
          busy={busy}
          disabled={!from || !to || to < from}
          onClick={async () => {
            setBusy(true);
            const r = await dispatch(addScorecardTimeOff({ ...who, starts_on: from, ends_on: to, label: label.trim() || undefined }));
            setBusy(false);
            if (addScorecardTimeOff.fulfilled.match(r)) {
              setLabel("");
              void dispatch(fetchScorecardDetail(who));
            }
          }}
        />
      </div>
    </section>
  );
}

/**
 * Admin -> Scorecards -> person: each scorecard with its trend and drill-down, the follow-up log
 * (coaching, meetings, warnings), the work that feeds the score, and days off.
 */
export default function ScorecardDetail() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const params = useParams();
  const type = (params.type === "affiliate" ? "affiliate" : "contractor") as ScorecardSubjectType;
  const id = Number(params.id);
  const { detail, detailLoading, error, saving } = useAppSelector((s) => s.scorecards);
  const d = detail && detail.subject.type === type && detail.subject.id === id ? detail : null;
  const [tab, setTab] = useState<string>("score");
  const [note, setNote] = useState("");
  const [eventNote, setEventNote] = useState("");
  const who = { type, id };

  useEffect(() => {
    if (id) void dispatch(fetchScorecardDetail({ type, id }));
  }, [dispatch, type, id]);

  const roles = d?.subject.roles || [];
  const toggleRole = async (r: ScorecardKind) => {
    const next = roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];
    await dispatch(setScorecardRoles({ id, roles: next }));
    void dispatch(fetchScorecardDetail(who));
  };
  const openCount = d?.actions.filter((a) => a.status === "open" && a.kind !== "note").length || 0;
  const tabs = useMemo(
    () => [
      { value: "score", labelKey: "scorecards.tabScore" },
      { value: "actions", labelKey: "scorecards.tabActions", count: openCount || null },
      { value: "work", labelKey: "scorecards.tabWork" },
      { value: "off", labelKey: "scorecards.tabOff", count: d?.time_off.length || null },
    ],
    [openCount, d?.time_off.length],
  );

  return (
    <div className="portal-page sc-page">
      <PageHeader titleKey="scorecards.title" title={d?.subject.name} leadKey="scorecards.detailLead" />
      <BackLink to="/admin/scorecards" />
      <ErrorNote error={error} />
      {detailLoading && !d ? <ScorecardDetailSkeleton /> : null}
      {d ? (
        <>
          <section className="pf-card sc-person">
            <span className="sc-person__avatar" aria-hidden>
              {d.subject.avatar_url ? <img src={d.subject.avatar_url} alt="" /> : initials(d.subject.name)}
            </span>
            <div className="sc-person__who">
              <p className="pf-kicker">{t(`scorecards.subject_${d.subject.type}`)}</p>
              <h2>{d.subject.name}</h2>
              <p className="pf-muted">{[d.subject.company, d.subject.email, d.subject.phone].filter(Boolean).join(" · ")}</p>
              <Link className="text-link sc-person__open" to={`/admin/${d.subject.type === "affiliate" ? "affiliates" : "contractors"}/${d.subject.id}`}>
                {t("scorecards.openRecord")}
              </Link>
            </div>
            {d.subject.type === "contractor" ? (
              <div className="sc-person__roles">
                <span className="pf-kicker">{t("scorecards.scoredAs")}</span>
                {(["lead_rep", "coordinator"] as ScorecardKind[]).map((r) => (
                  <label key={r} className={cn("sc-role", roles.includes(r) && "is-on")}>
                    <input type="checkbox" checked={roles.includes(r)} disabled={saving} onChange={() => void toggleRole(r)} />
                    {t(`scorecards.card_${r}`)}
                  </label>
                ))}
              </div>
            ) : null}
          </section>

          {!d.cards.length ? (
            <section className="pf-card">
              <EmptyState messageKey="scorecards.noRoles" />
            </section>
          ) : null}

          {d.cards.length ? (
            <>
              <SegmentedTabs value={tab} onChange={setTab} ariaLabel={t("scorecards.tabsAria")} options={tabs} />

              {tab === "score" ? (
                <div className="sc-cards">
                  {d.cards.map((c) => (
                    <CardPanel key={c.scorecard} card={c} />
                  ))}
                  <details className="pf-card sc-rules-card">
                    <summary>{t("scorecards.howTitle")}</summary>
                    <ScorecardRules only={d.cards.map((c) => c.scorecard)} />
                  </details>
                </div>
              ) : null}

              {tab === "actions" ? (
                <section className="pf-card">
                  <h2 className="pf-h2">{t("scorecards.followUps")}</h2>
                  <div className="sc-note-add">
                    <textarea rows={2} maxLength={4000} value={note} placeholder={t("scorecards.notePh")} onChange={(e) => setNote(e.target.value)} aria-label={t("scorecards.addNote")} />
                    <BusyButton
                      icon={MessageSquarePlus}
                      label={t("scorecards.addNote")}
                      busy={saving}
                      disabled={!note.trim()}
                      onClick={async () => {
                        const r = await dispatch(addScorecardNote({ ...who, body: note.trim(), scorecard: d.cards[0]?.scorecard }));
                        if (addScorecardNote.fulfilled.match(r)) setNote("");
                      }}
                    />
                  </div>
                  {!d.actions.length ? <p className="pf-muted">{t("scorecards.noActions")}</p> : null}
                  <ul className="sc-actions">
                    {d.actions.map((a) => (
                      <ActionItem key={a.id} a={a} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {tab === "work" ? (
                <div className="sc-work-wrap">
                  {roles.includes("lead_rep") ? <LeadsPanel d={d} /> : null}
                  {roles.includes("coordinator")
                    ? d.projects
                        .filter((p) => ["financing", "contracted", "in_build"].includes(p.milestone))
                        .map((p) => <ProjectTrackingPanel key={p.public_id} publicId={p.public_id} title={`${p.name}${p.address ? ` · ${p.address}` : ""}`} />)
                    : null}
                  {roles.includes("coordinator") && !d.projects.some((p) => ["financing", "contracted", "in_build"].includes(p.milestone)) ? (
                    <section className="pf-card">
                      <p className="pf-muted">{t("scorecards.noProjects")}</p>
                    </section>
                  ) : null}
                  {d.subject.type === "affiliate" ? (
                    <section className="pf-card sc-work">
                      <h2 className="pf-h2">{t("scorecards.m_events")}</h2>
                      <p className="pf-hint">{t("scorecards.eventHint")}</p>
                      <div className="sc-note-add">
                        <input value={eventNote} maxLength={4000} placeholder={t("scorecards.eventPh")} onChange={(e) => setEventNote(e.target.value)} aria-label={t("scorecards.logEvent")} />
                        <BusyButton
                          tone="gold"
                          icon={Plus}
                          label={t("scorecards.logEvent")}
                          busy={saving}
                          disabled={!eventNote.trim()}
                          onClick={async () => {
                            const r = await dispatch(logScorecardActivity({ ...who, body: { kind: "event_held", note: eventNote.trim() } }));
                            if (logScorecardActivity.fulfilled.match(r)) {
                              setEventNote("");
                              void dispatch(fetchScorecardDetail(who));
                            }
                          }}
                        />
                      </div>
                    </section>
                  ) : null}
                  <section className="pf-card">
                    <h2 className="pf-h2">{t("scorecards.log")}</h2>
                    {!d.activities.length ? <p className="pf-muted">{t("scorecards.noActivity")}</p> : null}
                    <ul className="sc-log">
                      {d.activities.map((a) => (
                        <li key={a.id}>
                          <span className={cn("sc-log__dot", `is-${a.kind}`)}>
                            {a.kind === "call_attempt" ? a.outcome === "answered" ? <Phone size={13} /> : <PhoneOff size={13} /> : <CheckCircle2 size={13} />}
                          </span>
                          <span className="sc-log__main">
                            <strong>
                              {t(`scorecards.k_${a.kind}`)}
                              {a.outcome ? ` · ${t(`scorecards.o_${a.outcome}`)}` : ""}
                            </strong>
                            <small>
                              {[a.lead_name, a.project_public_id, a.note].filter(Boolean).join(" · ")}
                            </small>
                          </span>
                          <small className="sc-log__when">
                            {fmt.relative(a.occurred_at)}
                            {a.by ? ` · ${a.by}` : ""}
                          </small>
                          <button
                            type="button"
                            className="pf-icon-btn"
                            aria-label={t("scorecards.delete")}
                            onClick={async () => {
                              await dispatch(deleteScorecardActivity(a.id));
                              void dispatch(fetchScorecardDetail(who));
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              ) : null}

              {tab === "off" ? <TimeOffPanel d={d} /> : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
