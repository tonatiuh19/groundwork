import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BadgeCheck, CalendarClock, Clock, LockKeyhole, MapPin, Phone, UserRound, Video, Building2 } from "lucide-react";
import type { AppointmentLocationType } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchBookingInfo, resetBooking, submitBooking } from "@/store/slices/bookingSlice";
import SlotPicker from "@/components/booking/SlotPicker";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PageMeta from "@/components/PageMeta";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import { slotLabel } from "@/lib/apptTime";
import { cn } from "@/lib/cn";

const LOC_ICON: Record<AppointmentLocationType, typeof MapPin> = { onsite: MapPin, phone: Phone, video: Video, office: Building2 };

/** Shared public chrome for booking + manage pages. */
export function BookingShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="gw-welcome gw-book">
      <header className="gw-welcome__top">
        <Link to="/" aria-label="Groundwork Capital">
          <img src="/logos/groundwork-logo.png" alt="Groundwork Capital" className="gw-welcome__logo" />
        </Link>
        <div className="gw-welcome__top-right">
          <span className="gw-welcome__secure">
            <LockKeyhole size={14} aria-hidden /> {t("booking.secure")}
          </span>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="gw-welcome__main gw-book__main">{children}</main>
    </div>
  );
}

/** /book/:slug — homeowner picks an open time with a staff member. */
export default function BookPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { slug = "" } = useParams();
  const dispatch = useAppDispatch();
  const { info, infoError, submitting, submitError, booked } = useAppSelector((s) => s.booking);
  const [pick, setPick] = useState<{ date: string; time: string } | null>(null);
  const [step, setStep] = useState<"time" | "details">("time");
  const [form, setForm] = useState({ name: "", email: "", phone: "", location_type: "" as string, address: "", notes: "" });

  useEffect(() => {
    dispatch(resetBooking());
  }, [dispatch, slug]);
  useEffect(() => {
    void dispatch(fetchBookingInfo({ slug, lang }));
  }, [dispatch, slug, lang]);
  useEffect(() => {
    if (info && !form.location_type) setForm((f) => ({ ...f, location_type: info.location_types[0] || "phone" }));
  }, [info, form.location_type]);

  const whenLabel = useMemo(() => {
    if (!pick) return "";
    const day = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${pick.date}T12:00:00Z`));
    return `${day} · ${slotLabel(pick.time, lang)}`;
  }, [pick, lang]);

  const valid =
    form.name.trim().length > 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) &&
    form.phone.replace(/\D/g, "").length >= 10 &&
    (form.location_type !== "onsite" || form.address.trim().length > 4);

  const submit = () => {
    if (!pick || !valid) return;
    void dispatch(
      submitBooking({
        slug,
        body: {
          date: pick.date,
          time: pick.time,
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          location_type: form.location_type,
          address: form.location_type === "onsite" ? form.address.trim() : undefined,
          notes: form.notes.trim() || undefined,
          lang,
        },
      }),
    ).then((r) => {
      // Someone took the time meanwhile → back to the time step with fresh slots.
      if (submitBooking.rejected.match(r) && r.payload === "errors.slotTaken") {
        setPick(null);
        setStep("time");
      }
    });
  };

  if (infoError) {
    return (
      <BookingShell>
        <section className="gw-welcome__card gw-welcome__expired">
          <CalendarClock size={28} aria-hidden />
          <h1>{t("booking.unavailableTitle")}</h1>
          <p>{t("booking.unavailableLead")}</p>
          <Link className="button button-gold" to="/">
            {t("booking.home")}
          </Link>
        </section>
      </BookingShell>
    );
  }
  if (!info) return <BookingShell><Loading /></BookingShell>;

  return (
    <BookingShell>
      <PageMeta title={`${info.title} · ${info.host.name}`} description={info.description || t("booking.metaLead")} noIndex />
      <section className="gw-book__host">
        <span className="gw-book__avatar" aria-hidden>
          {info.host.avatar_url ? <img src={info.host.avatar_url} alt="" /> : <UserRound size={26} />}
        </span>
        <div>
          <span className="gw-welcome__eyebrow">{info.host.name}</span>
          <h1>{info.title}</h1>
          <p className="gw-book__meta">
            <Clock size={14} aria-hidden /> {t("appt.minutes", { count: info.duration_minutes })}
          </p>
          {info.description ? <p>{info.description}</p> : null}
        </div>
      </section>

      {booked ? (
        <section className="gw-welcome__card gw-welcome__done" role="status">
          <BadgeCheck size={30} aria-hidden />
          <h2>{t("booking.confirmedTitle")}</h2>
          <p>{whenLabel}</p>
          <p>{t("booking.confirmedLead", { email: form.email })}</p>
        </section>
      ) : step === "time" ? (
        <section className="gw-book__card">
          <h2 className="gw-book__step">
            <span>1</span> {t("booking.pickTime")}
          </h2>
          <ErrorNote error={submitError} />
          <SlotPicker slug={slug} timezone={info.timezone} days={info.days} advanceDays={info.advance_days} value={pick} onChange={setPick} />
          <div className="pf-actions gw-book__actions">
            <button type="button" className="button button-gold" disabled={!pick} onClick={() => setStep("details")}>
              {t("booking.next")}
            </button>
          </div>
        </section>
      ) : (
        <section className="gw-book__card">
          <button type="button" className="gw-book__back" onClick={() => setStep("time")}>
            <ArrowLeft size={14} aria-hidden /> {whenLabel}
          </button>
          <h2 className="gw-book__step">
            <span>2</span> {t("booking.yourDetails")}
          </h2>
          <div className="pf-form">
            <ErrorNote error={submitError} />
            <label className="pf-field">
              <span>{t("booking.name")}</span>
              <input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <div className="pf-form-grid">
              <label className="pf-field">
                <span>{t("form.email")}</span>
                <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <label className="pf-field">
                <span>{t("form.phone")}</span>
                <input type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
            </div>
            {info.location_types.length > 1 ? (
              <div className="gw-seg" role="radiogroup" aria-label={t("appt.where")}>
                {info.location_types.map((v) => {
                  const Icon = LOC_ICON[v];
                  return (
                    <button key={v} type="button" role="radio" aria-checked={form.location_type === v} className={cn("gw-seg__opt", form.location_type === v && "is-on")} onClick={() => setForm({ ...form, location_type: v })}>
                      <Icon size={15} aria-hidden /> {t(`appt.loc.${v}`)}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {form.location_type === "onsite" ? (
              <label className="pf-field">
                <span>{t("booking.propertyAddress")}</span>
                <input autoComplete="street-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
            ) : null}
            <label className="pf-field">
              <span>{t("booking.notes")}</span>
              <textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <BusyButton tone="gold" className="gw-book__submit" icon={CalendarClock} label={t("booking.confirm")} busyLabel={t("booking.booking")} busy={submitting} disabled={!valid} onClick={submit} />
            <p className="pf-hint">{t("booking.privacy")}</p>
          </div>
        </section>
      )}
    </BookingShell>
  );
}
