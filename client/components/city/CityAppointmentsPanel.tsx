import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, CalendarDays, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchCityAppointments } from "@/store/slices/cityPartnerSlice";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";
import { EmptyState } from "@/components/portal/kit";
import AppointmentDrawer from "@/components/admin/AppointmentDrawer";

/**
 * Staff City Pipeline → Meetings: every appointment tagged with this city (staff-booked and City Partner
 * meetings), upcoming first. "Schedule appointment" opens the usual drawer with the city already picked.
 */
export default function CityAppointmentsPanel({ cityId }: { cityId: number }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const canSchedule = useAdminCan("projects.write");
  const items = useAppSelector((s) => s.cityPartner.cityAppointments);
  const [open, setOpen] = useState(false);
  const load = () => void dispatch(fetchCityAppointments(cityId));
  useEffect(load, [cityId]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = Date.now();
  return (
    <section className="gw-city-appts">
      <div className="gw-city-appts__head">
        <p className="pf-hint">{t("cityPartner.cityAppointmentsLead")}</p>
        {canSchedule ? (
          <button type="button" className="pf-btn pf-btn--gold pf-btn--sm" onClick={() => setOpen(true)}>
            <CalendarPlus size={15} aria-hidden /> {t("appt.schedule")}
          </button>
        ) : null}
      </div>
      {items.length ? (
        <ul className="gw-city-appts__list">
          {items.map((a) => {
            const past = a.starts_at ? new Date(a.starts_at).getTime() < now : false;
            return (
              <li key={a.id} className={past || a.status === "cancelled" ? "gw-city-appts__item is-past" : "gw-city-appts__item"}>
                <span className={`gw-appt-item__dot is-${a.kind}`} aria-hidden />
                <div className="gw-city-appts__body">
                  <div className="gw-city-appts__when">
                    <CalendarDays size={13} aria-hidden /> {fmt.eventDateTime(a.starts_at)}
                    {a.status === "cancelled" ? <span className="pf-badge pf-badge--muted">{t("appt.status.cancelled", { defaultValue: "Cancelled" })}</span> : null}
                  </div>
                  <Link className="gw-city-appts__title" to={`/admin/calendar?appointment=${a.id}`}>
                    {t(`appt.kind.${a.kind}`)} · {a.title}
                  </Link>
                  <span className="pf-hint">
                    <Users size={13} aria-hidden /> {[a.who, a.owner_name, a.partner_company ? t("cityPartner.bookedByPartner", { company: a.partner_company }) : null].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState messageKey="cityPartner.cityAppointmentsEmpty" />
      )}
      {canSchedule ? <AppointmentDrawer open={open} onClose={() => setOpen(false)} context={{ city_id: cityId }} onSaved={load} /> : null}
    </section>
  );
}
