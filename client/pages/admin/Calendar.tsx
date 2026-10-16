import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMediaQuery, PHONE_QUERY } from "@/hooks/useMediaQuery";
import { useTranslation } from "react-i18next";
import { CalendarPlus, ChevronLeft, ChevronRight, LayoutGrid, List, MapPin } from "lucide-react";
import type { Appointment } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAppointmentById, fetchCalendar } from "@/store/slices/schedulerSlice";
import AppointmentDrawer from "@/components/admin/AppointmentDrawer";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { DEFAULT_TZ, formatApptRange, formatApptTime, isoToZoned, monthGrid, todayIn } from "@/lib/apptTime";
import { cn } from "@/lib/cn";

type View = "month" | "agenda";

/**
 * /admin/calendar — month grid + agenda of appointments (Pacific time),
 * "Mine / Everyone", click a day to schedule, click an event to edit.
 */
export default function AdminCalendar() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.portalAuth.admin.user);
  const { calendar, calendarLoading, calendarError } = useAppSelector((s) => s.scheduler);
  const canWrite = useAdminCan("projects.write");
  const [params, setParams] = useSearchParams();
  const today = todayIn(DEFAULT_TZ);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem("gw.calendar.view") as View) || (window.innerWidth < 720 ? "agenda" : "month");
    } catch {
      return "month";
    }
  });
  const [mine, setMine] = useState(false);
  // Phones: the month grid can't fit without sideways scrolling — always the agenda.
  const phone = useMediaQuery(PHONE_QUERY);
  const shownView: View = phone ? "agenda" : view;
  const [drawer, setDrawer] = useState<{ open: boolean; appt: Appointment | null; date?: string }>({ open: false, appt: null });

  const days = useMemo(() => monthGrid(month), [month]);
  const load = useCallback(() => {
    const from = new Date(`${days[0]}T00:00:00Z`).getTime() - 86400_000;
    const to = new Date(`${days[41]}T23:59:59Z`).getTime() + 86400_000;
    void dispatch(
      fetchCalendar({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        ...(mine && me?.id ? { admin_id: me.id } : {}),
      }),
    );
  }, [dispatch, days, mine, me?.id]);
  useEffect(load, [load]);

  // Deep link from emails: /admin/calendar?appointment=123
  useEffect(() => {
    const id = Number(params.get("appointment"));
    if (!id) return;
    void dispatch(fetchAppointmentById(id)).then((r) => {
      if (fetchAppointmentById.fulfilled.match(r)) {
        const a = r.payload.appointment;
        setMonth(isoToZoned(a.starts_at, a.timezone).date.slice(0, 7));
        setDrawer({ open: true, appt: a });
      }
    });
    setParams({}, { replace: true });
  }, [params, setParams, dispatch]);

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of calendar) {
      const d = isoToZoned(a.starts_at, a.timezone).date;
      m.set(d, [...(m.get(d) || []), a]);
    }
    return m;
  }, [calendar]);

  const setViewSaved = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("gw.calendar.view", v);
    } catch {
      /* per-device preference only */
    }
  };
  const shift = (n: number) => {
    const d = new Date(`${month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthLabel = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 4 + i))),
  );
  const agenda = calendar.filter((a) => isoToZoned(a.starts_at, a.timezone).date >= (month === today.slice(0, 7) ? today : `${month}-01`));

  return (
    <div className="portal-page gw-calendar-page">
      <PageHeader
        titleKey="calendar.title"
        leadKey="calendar.lead"
        actions={
          canWrite ? (
            <button type="button" className="button button-gold" onClick={() => setDrawer({ open: true, appt: null, date: today })}>
              <CalendarPlus size={16} aria-hidden /> {t("appt.schedule")}
            </button>
          ) : undefined
        }
      />
      <div className="gw-cal-toolbar">
        <div className="gw-cal-nav">
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => shift(-1)} aria-label={t("calendar.prev")}>
            <ChevronLeft size={16} aria-hidden />
          </button>
          <strong className="gw-cal-month">{monthLabel}</strong>
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => shift(1)} aria-label={t("calendar.next")}>
            <ChevronRight size={16} aria-hidden />
          </button>
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => setMonth(today.slice(0, 7))}>
            {t("calendar.today")}
          </button>
        </div>
        <div className="gw-cal-filters">
          <div className="pf-segmented" role="tablist" aria-label={t("calendar.whose")}>
            <button type="button" role="tab" aria-selected={!mine} className={cn("pf-segmented-tab", !mine && "is-active")} onClick={() => setMine(false)}>
              {t("calendar.everyone")}
            </button>
            <button type="button" role="tab" aria-selected={mine} className={cn("pf-segmented-tab", mine && "is-active")} onClick={() => setMine(true)}>
              {t("calendar.mine")}
            </button>
          </div>
          {phone ? null : (
          <div className="pf-segmented" role="tablist" aria-label={t("calendar.view")}>
            <button type="button" role="tab" aria-selected={view === "month"} className={cn("pf-segmented-tab", view === "month" && "is-active")} onClick={() => setViewSaved("month")}>
              <LayoutGrid size={14} aria-hidden /> {t("calendar.month")}
            </button>
            <button type="button" role="tab" aria-selected={view === "agenda"} className={cn("pf-segmented-tab", view === "agenda" && "is-active")} onClick={() => setViewSaved("agenda")}>
              <List size={14} aria-hidden /> {t("calendar.agenda")}
            </button>
          </div>
          )}
        </div>
      </div>
      <ErrorNote error={calendarError} />

      {shownView === "month" ? (
        <div className={cn("gw-cal-grid-wrap", calendarLoading && "is-loading")}>
          <div className="gw-cal-grid" role="grid" aria-label={monthLabel}>
            {weekdays.map((w) => (
              <div key={w} className="gw-cal-wd" role="columnheader">
                {w}
              </div>
            ))}
            {days.map((d) => {
              const items = byDay.get(d) || [];
              const outside = d.slice(0, 7) !== month;
              return (
                <div
                  key={d}
                  role="gridcell"
                  className={cn("gw-cal-day", outside && "is-outside", d === today && "is-today", d < today && "is-past")}
                  onClick={() => canWrite && d >= today && setDrawer({ open: true, appt: null, date: d })}
                >
                  <span className="gw-cal-day__num">{Number(d.slice(8))}</span>
                  {items.slice(0, 3).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={cn("gw-cal-event", `is-${a.kind}`, a.status !== "scheduled" && `is-${a.status}`)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDrawer({ open: true, appt: a });
                      }}
                      title={a.title}
                    >
                      <span>{formatApptTime(a.starts_at, a.timezone, lang)}</span> {a.client_name || a.lead_name || a.title}
                    </button>
                  ))}
                  {items.length > 3 ? <span className="gw-cal-more">{t("calendar.more", { count: items.length - 3 })}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ul className="gw-appt-list gw-cal-agenda">
          {!agenda.length && !calendarLoading ? <li className="pf-muted">{t("calendar.empty")}</li> : null}
          {agenda.map((a, i) => {
            const d = isoToZoned(a.starts_at, a.timezone).date;
            const prev = i > 0 ? isoToZoned(agenda[i - 1].starts_at, agenda[i - 1].timezone).date : null;
            return (
              <li key={a.id}>
                {d !== prev ? (
                  <h3 className="gw-cal-agenda__day">
                    {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}
                    {d === today ? <span className="pf-badge pf-badge--gold">{t("calendar.today")}</span> : null}
                  </h3>
                ) : null}
                <button type="button" className={cn("gw-appt-item", a.status === "cancelled" && "is-cancelled")} onClick={() => setDrawer({ open: true, appt: a })}>
                  <span className={cn("gw-appt-item__dot", `is-${a.kind}`)} aria-hidden />
                  <span className="gw-appt-item__main">
                    <strong>{a.title}</strong>
                    <span>{formatApptRange(a.starts_at, a.ends_at, a.timezone, lang)}</span>
                    {a.location ? (
                      <span className="gw-appt-item__meta">
                        <MapPin size={12} aria-hidden /> {a.location}
                      </span>
                    ) : null}
                  </span>
                  {a.status !== "scheduled" ? <StatusBadge group="appt.status" value={a.status} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AppointmentDrawer
        open={drawer.open}
        appointment={drawer.appt}
        context={drawer.appt ? undefined : { date: drawer.date }}
        onClose={() => setDrawer({ open: false, appt: null })}
        onSaved={load}
      />
    </div>
  );
}
