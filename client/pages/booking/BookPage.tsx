import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarClock,
  CalendarPlus,
  Check,
  Clock,
  Download,
  KeyRound,
  Handshake,
  HardHat,
  Home,
  Languages,
  LockKeyhole,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
  Video,
} from "lucide-react";
import type { AppointmentLocationType, BookingTypeKey } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearBookingCode, fetchBookingInfo, resetBooking, submitBooking } from "@/store/slices/bookingSlice";
import SpamShieldTrap from "@/components/spam/SpamShieldTrap";
import SlotPicker from "@/components/booking/SlotPicker";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PageMeta from "@/components/PageMeta";
import { aduDesignPhoto } from "@/components/AduDesignSheet";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import { slotLabel } from "@/lib/apptTime";
import { captureReferralFromUrl, getReferralCode } from "@/lib/referral";
import { bookingCalendarLinks } from "@/lib/bookingCalendar";
import { cn } from "@/lib/cn";

const LOC_ICON: Record<AppointmentLocationType, typeof MapPin> = { onsite: MapPin, phone: Phone, video: Video, office: Building2 };
const TYPE_ICON: Record<BookingTypeKey, typeof Home> = { homeowner: Home, affiliate: Handshake, contractor: HardHat };
/** Exterior photo id → designs.plan{n} copy (Veranda 474, Summit 830, Haven 445). */
const PLANS = [3, 1, 2] as const;

/** Shared public chrome for booking + manage pages. */
export function BookingShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
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
      <main className={cn("gw-welcome__main gw-book__main", wide && "gw-book__main--wide")}>{children}</main>
    </div>
  );
}

/**
 * /book/:slug — public booking page: pick the kind of call (homeowner ADU consultation, or the
 * affiliate / contractor calls the host turned on), an open time, then name + phone (email optional).
 * `?type=affiliate` deep-links a call type; affiliate links / QR codes the visitor came through are credited.
 */
export default function BookPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const type = (["homeowner", "affiliate", "contractor"].includes(params.get("type") || "") ? params.get("type") : "homeowner") as BookingTypeKey;
  const dispatch = useAppDispatch();
  const { info, infoError, submitting, submitError, booked, needsCode } = useAppSelector((s) => s.booking);
  const [code, setCode] = useState("");
  const [pick, setPick] = useState<{ date: string; time: string } | null>(null);
  const [step, setStep] = useState<"time" | "details">("time");
  const [form, setForm] = useState({ name: "", email: "", phone: "", location_type: "" as string, address: "", notes: "" });

  useEffect(() => {
    captureReferralFromUrl(window.location.search);
  }, []);
  useEffect(() => {
    dispatch(resetBooking());
    setPick(null);
    setStep("time");
  }, [dispatch, slug, type]);
  useEffect(() => {
    void dispatch(fetchBookingInfo({ slug, lang, type }));
  }, [dispatch, slug, lang, type]);
  // The server falls back to the homeowner call when a shared ?type= is off: keep the URL in step.
  useEffect(() => {
    if (info && info.type !== type) setType(info.type);
  }, [info?.type]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (info && (!form.location_type || !info.location_types.includes(form.location_type as AppointmentLocationType)))
      setForm((f) => ({ ...f, location_type: info.location_types[0] || "phone" }));
  }, [info, form.location_type]);

  const whenLabel = useMemo(() => {
    if (!pick) return "";
    const day = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${pick.date}T12:00:00Z`));
    return `${day} · ${slotLabel(pick.time, lang)}`;
  }, [pick, lang]);

  const emailOk = !form.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const valid =
    form.name.trim().length > 1 &&
    emailOk &&
    form.phone.replace(/\D/g, "").length >= 10 &&
    (form.location_type !== "onsite" || form.address.trim().length > 4);

  const setType = (k: BookingTypeKey) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (k === "homeowner") next.delete("type");
        else next.set("type", k);
        return next;
      },
      { replace: true },
    );

  const submit = (phoneCode?: string) => {
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
          type,
          referral_code: getReferralCode(),
          phone_code: phoneCode,
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
          <a className="button button-gold" href="tel:+18668647506">
            <Phone size={15} aria-hidden /> (866) 864-7506
          </a>
          <Link className="text-link" to="/">
            {t("booking.home")}
          </Link>
        </section>
      </BookingShell>
    );
  }
  if (!info) return <BookingShell><Loading /></BookingShell>;

  // Company page: "Groundwork Capital will call you"; personal link: the host's first name.
  const hostShort = info.host.team ? info.host.name : info.host.name.split(" ")[0];
  const cal = pick && booked ? bookingCalendarLinks({ title: `${info.title} · Groundwork Capital`, date: pick.date, time: pick.time, minutes: info.duration_minutes, timezone: info.timezone, details: t("booking.calDetails", { host: info.host.name }) }) : null;

  return (
    <BookingShell wide>
      <PageMeta title={`${info.title} · ${info.host.name}`} description={info.description || t("booking.metaLead")} noIndex />

      <section className="gw-book__hero">
        <span className="gw-book__avatar" aria-hidden>
          {info.host.avatar_url ? <img src={info.host.avatar_url} alt="" /> : info.host.team ? <Building2 size={30} /> : <UserRound size={30} />}
        </span>
        <div className="gw-book__hero-text">
          <span className="gw-welcome__eyebrow">{t("booking.withHost", { host: info.host.name })}</span>
          <h1>{info.title}</h1>
          <div className="gw-book__chips">
            <span className="gw-book__chip">
              <Clock size={14} aria-hidden /> {t("appt.minutes", { count: info.duration_minutes })}
            </span>
            {info.location_types.map((v) => {
              const Icon = LOC_ICON[v];
              return (
                <span key={v} className="gw-book__chip">
                  <Icon size={14} aria-hidden /> {t(`appt.loc.${v}`)}
                </span>
              );
            })}
            <span className="gw-book__chip">
              <Languages size={14} aria-hidden /> {t("booking.bilingual")}
            </span>
          </div>
          {info.description ? <p className="gw-book__desc">{info.description}</p> : null}
        </div>
      </section>

      {info.types.length > 1 && !booked ? (
        <div className="gw-book__types" role="radiogroup" aria-label={t("booking.typePicker")}>
          {info.types.map((x) => {
            const Icon = TYPE_ICON[x.key];
            return (
              <button key={x.key} type="button" role="radio" aria-checked={type === x.key} className={cn("gw-book__type", type === x.key && "is-on")} onClick={() => setType(x.key)}>
                <Icon size={18} aria-hidden />
                <span className="gw-book__type-title">{t(`booking.typeFor_${x.key}`)}</span>
                <span className="gw-book__type-meta">{t("appt.minutes", { count: x.duration_minutes })}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="gw-book__layout">
        <div className="gw-book__primary">
          {/* Primed when the page opens, so the shield's timing check measures the whole visit. */}
          <SpamShieldTrap form="booking" />
          {booked ? (
            <section className="gw-book__card gw-book__done" role="status">
              <span className="gw-book__done-icon" aria-hidden>
                <BadgeCheck size={34} />
              </span>
              <h2>{t("booking.confirmedTitle")}</h2>
              <p className="gw-book__done-when">{whenLabel}</p>
              <p>{form.email.trim() ? t("booking.confirmedLead", { email: form.email.trim() }) : t("booking.confirmedLeadPhone", { phone: form.phone.trim() })}</p>
              {cal ? (
                <div className="gw-book__cal">
                  <a className="button button-gold" href={cal.google} target="_blank" rel="noreferrer">
                    <CalendarPlus size={15} aria-hidden /> {t("booking.addGoogle")}
                  </a>
                  <a className="button" href={cal.ics} download="groundwork-appointment.ics">
                    <Download size={15} aria-hidden /> {t("booking.addIcs")}
                  </a>
                </div>
              ) : null}
              <div className="gw-book__next">
                <h3>{t("booking.nextTitle")}</h3>
                <ol>
                  {[1, 2, 3].map((n) => (
                    <li key={n}>{t(`booking.next_${n}`, { host: hostShort })}</li>
                  ))}
                </ol>
              </div>
            </section>
          ) : needsCode !== null ? (
            <section className="gw-book__card gw-book__verify">
              <span className="gw-book__verify-icon" aria-hidden>
                <KeyRound size={24} />
              </span>
              <h2>{t("booking.verifyTitle")}</h2>
              <p>{t("booking.verifyLead", { last4: needsCode })}</p>
              <ErrorNote error={submitError} />
              <input
                className="pf-input gw-book__code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                aria-label={t("booking.verifyLabel")}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.length === 6) submit(code);
                }}
              />
              <BusyButton tone="gold" className="gw-book__submit" icon={BadgeCheck} label={t("booking.verifyConfirm")} busyLabel={t("booking.booking")} busy={submitting} disabled={code.length !== 6} onClick={() => submit(code)} />
              <div className="gw-book__verify-links">
                <button type="button" className="text-link" disabled={submitting} onClick={() => { setCode(""); submit(); }}>
                  {t("booking.verifyResend")}
                </button>
                <button type="button" className="text-link" onClick={() => { setCode(""); dispatch(clearBookingCode()); }}>
                  {t("booking.verifyChange")}
                </button>
              </div>
            </section>
          ) : step === "time" ? (
            <section className="gw-book__card">
              <h2 className="gw-book__step">
                <span>1</span> {t("booking.pickTime")}
              </h2>
              <ErrorNote error={submitError} />
              <SlotPicker slug={slug} type={type} timezone={info.timezone} days={info.days} advanceDays={info.advance_days} value={pick} onChange={setPick} />
              <div className="pf-actions gw-book__actions">
                <button type="button" className="button button-gold" disabled={!pick} onClick={() => setStep("details")}>
                  {pick ? t("booking.nextWith", { when: whenLabel }) : t("booking.next")}
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
                    <span>{t("form.phone")}</span>
                    <input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    <small className="pf-hint">{t("booking.phoneHint")}</small>
                  </label>
                  <label className="pf-field">
                    <span>
                      {t("form.email")} <em className="gw-book__opt">{t("booking.optional")}</em>
                    </span>
                    <input type="email" inputMode="email" autoComplete="email" value={form.email} aria-invalid={!emailOk} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    <small className="pf-hint">{t("booking.emailHint")}</small>
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
                {form.location_type === "video" ? <p className="pf-hint gw-book__note"><Video size={14} aria-hidden /> {t("booking.videoNote")}</p> : null}
                {form.location_type === "phone" ? <p className="pf-hint gw-book__note"><Phone size={14} aria-hidden /> {t("booking.phoneNote", { host: hostShort })}</p> : null}
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
                <BusyButton tone="gold" className="gw-book__submit" icon={CalendarClock} label={t("booking.confirm")} busyLabel={t("booking.booking")} busy={submitting} disabled={!valid} onClick={() => submit()} />
                <p className="pf-hint">{t("booking.privacy")}</p>
              </div>
            </section>
          )}
        </div>

        <aside className="gw-book__aside" aria-label={t("booking.coverTitle")}>
          <section className="gw-book__panel">
            <h2>
              <Sparkles size={16} aria-hidden /> {t("booking.coverTitle")}
            </h2>
            <ul className="gw-book__cover">
              {[1, 2, 3, 4].map((n) => (
                <li key={n}>
                  <Check size={15} aria-hidden /> {t(`booking.cover_${type}_${n}`)}
                </li>
              ))}
            </ul>
          </section>
          {type === "homeowner" ? (
            <section className="gw-book__panel">
              <h2>{t("booking.plansTitle")}</h2>
              <div className="gw-book__plans">
                {PLANS.map((id) => (
                  <figure key={id} className="gw-book__plan">
                    <img src={aduDesignPhoto(id)} alt={t(`designs.alt${id}`)} loading="lazy" />
                    <figcaption>
                      <strong>{t(`designs.plan${id}Kicker`)}</strong>
                      <span>{t(`designs.plan${id}Label`)}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ) : null}
          <ul className="gw-book__trust">
            <li>
              <ShieldCheck size={16} aria-hidden /> {t(type === "homeowner" ? "booking.trustPlans" : "booking.trustTeam")}
            </li>
            <li>
              <Languages size={16} aria-hidden /> {t("booking.trustBilingual")}
            </li>
            <li>
              <CalendarClock size={16} aria-hidden /> {t("booking.trustReschedule")}
            </li>
          </ul>
        </aside>
      </div>
    </BookingShell>
  );
}
