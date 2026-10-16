import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, CalendarPlus, HardHat, Landmark, MapPin, Users } from "lucide-react";
import type { Appointment } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchRecordAppointments } from "@/store/slices/schedulerSlice";
import AppointmentDrawer, { type AppointmentContext } from "@/components/admin/AppointmentDrawer";
import { StatusBadge } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { formatApptRange } from "@/lib/apptTime";
import { cn } from "@/lib/cn";

/**
 * Client / project / lead page → Appointments: upcoming + recent, who's
 * tagged, and "Schedule" (opens the appointment drawer prefilled with this
 * record — property address, homeowner confirmation).
 */
export default function AppointmentsPanel({ context }: { context: AppointmentContext }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const dispatch = useAppDispatch();
  const canWrite = useAdminCan("projects.write");
  const key = `c${context.client_id ?? ""}-p${context.project_id ?? ""}-l${context.lead_id ?? ""}`;
  const list = useAppSelector((s) => s.scheduler.byRecord[key]) || [];
  const [drawer, setDrawer] = useState<{ open: boolean; appt: Appointment | null }>({ open: false, appt: null });

  const load = useCallback(() => {
    // 60 days back … ~2 months ahead (API caps a range at 120 days).
    const from = new Date(Date.now() - 60 * 86400_000);
    void dispatch(
      fetchRecordAppointments({
        key,
        from: from.toISOString(),
        to: new Date(from.getTime() + 119 * 86400_000).toISOString(),
        ...(context.client_id ? { client_id: context.client_id } : context.project_id ? { project_id: context.project_id } : context.lead_id ? { lead_id: context.lead_id } : {}),
        include_cancelled: true,
      }),
    );
  }, [dispatch, key, context.client_id, context.project_id, context.lead_id]);
  useEffect(load, [load]);

  const now = Date.now();
  const upcoming = list.filter((a) => new Date(a.ends_at).getTime() >= now && a.status !== "cancelled");
  const past = list.filter((a) => !upcoming.includes(a)).reverse().slice(0, 5);

  const row = (a: Appointment) => (
    <li key={a.id}>
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
          <span className="gw-appt-item__people">
            {a.attendees.filter((x) => x.kind === "admin").length ? (
              <span>
                <Users size={12} aria-hidden /> {a.attendees.filter((x) => x.kind === "admin").map((x) => x.name).join(", ")}
              </span>
            ) : null}
            {a.attendees.some((x) => x.kind === "contractor") ? (
              <span>
                <HardHat size={12} aria-hidden /> {a.attendees.filter((x) => x.kind === "contractor").map((x) => x.name).join(", ")}
              </span>
            ) : null}
            {a.attendees.some((x) => x.kind === "lender") ? (
              <span>
                <Landmark size={12} aria-hidden /> {a.attendees.filter((x) => x.kind === "lender").map((x) => x.name).join(", ")}
              </span>
            ) : null}
          </span>
        </span>
        {a.status !== "scheduled" ? <StatusBadge group="appt.status" value={a.status} /> : null}
      </button>
    </li>
  );

  return (
    <section className="pf-section gw-appt-panel">
      <div className="gw-details-head">
        <h2 className="pf-h2">
          <CalendarClock size={17} aria-hidden /> {t("appt.panelTitle")}
        </h2>
        {canWrite ? (
          <button type="button" className="pf-btn pf-btn--sm pf-btn--gold" onClick={() => setDrawer({ open: true, appt: null })}>
            <CalendarPlus size={14} aria-hidden /> {t("appt.schedule")}
          </button>
        ) : null}
      </div>
      {!upcoming.length ? <p className="pf-muted">{t("appt.noneUpcoming")}</p> : <ul className="gw-appt-list">{upcoming.map(row)}</ul>}
      {past.length ? (
        <details className="gw-appt-past">
          <summary>{t("appt.past", { count: past.length })}</summary>
          <ul className="gw-appt-list">{past.map(row)}</ul>
        </details>
      ) : null}
      <AppointmentDrawer
        open={drawer.open}
        appointment={drawer.appt}
        context={context}
        onClose={() => setDrawer({ open: false, appt: null })}
        onSaved={load}
      />
    </section>
  );
}
