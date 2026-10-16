import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarClock, CalendarX2, MapPin, UserRound } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  cancelManagedAppointment,
  fetchBookingInfo,
  fetchManagedAppointment,
  rescheduleManagedAppointment,
} from "@/store/slices/bookingSlice";
import SlotPicker from "@/components/booking/SlotPicker";
import { BookingShell } from "@/pages/booking/BookPage";
import PageMeta from "@/components/PageMeta";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import { formatApptRange } from "@/lib/apptTime";

/** /appointment/:token — the homeowner / booker reschedules or cancels (link from their email). */
export default function ManageAppointment() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { token = "" } = useParams();
  const dispatch = useAppDispatch();
  const { manage, manageError, manageBusy, info } = useAppSelector((s) => s.booking);
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel" | "done">("view");
  const [pick, setPick] = useState<{ date: string; time: string } | null>(null);
  const [reason, setReason] = useState("");

  const load = () => void dispatch(fetchManagedAppointment(token));
  useEffect(load, [dispatch, token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode === "reschedule" && manage?.reschedule_slug) void dispatch(fetchBookingInfo({ slug: manage.reschedule_slug, lang }));
  }, [mode, manage?.reschedule_slug, lang, dispatch]);

  if (manageError && !manage) {
    return (
      <BookingShell>
        <section className="gw-welcome__card gw-welcome__expired">
          <CalendarX2 size={28} aria-hidden />
          <h1>{t("manage.notFoundTitle")}</h1>
          <p>{t("manage.notFoundLead")}</p>
          <Link className="button button-gold" to="/">
            {t("booking.home")}
          </Link>
        </section>
      </BookingShell>
    );
  }
  if (!manage) return <BookingShell><Loading /></BookingShell>;
  const a = manage.appointment;
  const past = new Date(a.starts_at).getTime() < Date.now();
  const active = a.status === "scheduled" && !past;

  return (
    <BookingShell>
      <PageMeta title={t("manage.metaTitle")} description={t("manage.metaTitle")} noIndex />
      <section className="gw-book__card gw-manage">
        <span className="gw-welcome__eyebrow">{t("manage.eyebrow")}</span>
        <h1 className="gw-manage__title">{a.title}</h1>
        <p className="gw-manage__when">
          <CalendarClock size={16} aria-hidden /> {formatApptRange(a.starts_at, a.ends_at, a.timezone, lang)}
        </p>
        {a.location || a.video_url ? (
          <p className="gw-manage__where">
            <MapPin size={16} aria-hidden /> {t(`appt.loc.${a.location_type}`)}
            {a.location ? ` · ${a.location}` : ""}
            {a.location_type === "video" && a.video_url ? (
              <>
                {" · "}
                <a href={a.video_url} target="_blank" rel="noreferrer">
                  {t("manage.join")}
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {a.host ? (
          <p className="gw-manage__where">
            <UserRound size={16} aria-hidden /> {t("manage.with", { name: a.host })}
          </p>
        ) : null}
        {a.status === "cancelled" ? <p className="gw-onboard-note">{t("manage.cancelled")}</p> : null}
        {mode === "done" ? (
          <p className="gw-welcome__pending" role="status">
            <BadgeCheck size={15} aria-hidden /> {t("manage.updated")}
          </p>
        ) : null}
        <ErrorNote error={manageError} />

        {active && mode !== "reschedule" && mode !== "cancel" ? (
          <div className="pf-actions gw-book__actions">
            {manage.reschedule_slug ? (
              <button type="button" className="button button-gold" onClick={() => setMode("reschedule")}>
                {t("manage.reschedule")}
              </button>
            ) : null}
            <button type="button" className="pf-btn pf-btn--danger" onClick={() => setMode("cancel")}>
              {t("manage.cancel")}
            </button>
          </div>
        ) : null}

        {mode === "reschedule" && manage.reschedule_slug && info ? (
          <div className="gw-manage__panel">
            <SlotPicker slug={manage.reschedule_slug} timezone={info.timezone} days={info.days} advanceDays={info.advance_days} value={pick} onChange={setPick} />
            <div className="pf-actions gw-book__actions">
              <button type="button" className="pf-btn" onClick={() => setMode("view")}>
                {t("pf.cancel")}
              </button>
              <BusyButton
                tone="gold"
                label={t("manage.confirmReschedule")}
                busy={manageBusy}
                disabled={!pick}
                onClick={() =>
                  pick &&
                  void dispatch(rescheduleManagedAppointment({ token, ...pick })).then((r) => {
                    if (rescheduleManagedAppointment.fulfilled.match(r)) {
                      setMode("done");
                      load();
                    }
                  })
                }
              />
            </div>
          </div>
        ) : null}

        {mode === "cancel" ? (
          <div className="gw-manage__panel">
            <label className="pf-field">
              <span>{t("manage.reason")}</span>
              <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="pf-actions gw-book__actions">
              <button type="button" className="pf-btn" onClick={() => setMode("view")}>
                {t("manage.keep")}
              </button>
              <BusyButton
                className="pf-btn--danger"
                label={t("manage.confirmCancel")}
                busy={manageBusy}
                onClick={() =>
                  void dispatch(cancelManagedAppointment({ token, reason })).then((r) => {
                    if (cancelManagedAppointment.fulfilled.match(r)) {
                      setMode("view");
                      load();
                    }
                  })
                }
              />
            </div>
          </div>
        ) : null}
      </section>
    </BookingShell>
  );
}
