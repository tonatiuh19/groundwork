import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarOff, Check, Copy, ExternalLink, Link2, Plus, Trash2 } from "lucide-react";
import type { SchedulerAvailability, SchedulerSettings } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addBlockedRange, fetchMyScheduler, removeBlockedRange, saveMyScheduler } from "@/store/slices/schedulerSlice";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import { cn } from "@/lib/cn";

const DAYS = [1, 2, 3, 4, 5, 6, 0];

/**
 * Profile → My booking link (like real-state's scheduler): homeowners pick an
 * open time on /book/:slug. Weekly hours, meeting length, buffer, notice,
 * horizon, meeting types, and days off. Bookings land on the calendar.
 */
export default function BookingLinkPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const dispatch = useAppDispatch();
  const { mine, mineSaving, mineError } = useAppSelector((s) => s.scheduler);
  const [form, setForm] = useState<SchedulerSettings | null>(null);
  const [copied, setCopied] = useState(false);
  const [block, setBlock] = useState({ from: "", to: "", label: "" });

  useEffect(() => {
    void dispatch(fetchMyScheduler());
  }, [dispatch]);
  useEffect(() => {
    if (mine?.settings) setForm(mine.settings);
  }, [mine?.settings]);

  if (!form) return <section className="pf-section"><Loading /></section>;
  const set = (patch: Partial<SchedulerSettings>) => setForm({ ...form, ...patch });
  const dayName = (d: number) => new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 4 + d)));
  const ranges = (d: number) => form.availability.filter((w) => w.day_of_week === d);
  const setRanges = (d: number, next: SchedulerAvailability[]) =>
    set({ availability: [...form.availability.filter((w) => w.day_of_week !== d), ...next].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)) });
  const save = () => void dispatch(saveMyScheduler(form));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mine!.booking_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is visible to copy by hand */
    }
  };

  return (
    <section className="pf-section gw-booking-admin">
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <Link2 size={17} aria-hidden /> {t("booking.adminTitle")}
        </h2>
        <label className="gw-switch">
          <input type="checkbox" checked={form.is_enabled} onChange={(e) => set({ is_enabled: e.target.checked })} />
          <span className="gw-switch__track" aria-hidden />
          <span>{form.is_enabled ? t("booking.on") : t("booking.off")}</span>
        </label>
      </div>
      <p className="pf-hint">{t("booking.adminLead")}</p>
      <div className="gw-booking-link">
        <code>{mine?.booking_url}</code>
        <button type="button" className="pf-btn pf-btn--sm" onClick={() => void copy()}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? t("booking.copied") : t("booking.copy")}
        </button>
        {form.is_enabled ? (
          <a className="pf-btn pf-btn--sm" href={mine?.booking_url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> {t("booking.preview")}
          </a>
        ) : null}
      </div>
      <ErrorNote error={mineError} />

      <div className="pf-form">
        <div className="pf-form-grid">
          <label className="pf-field">
            <span>{t("booking.slug")}</span>
            <input value={form.slug} maxLength={60} onChange={(e) => set({ slug: e.target.value })} />
          </label>
          <label className="pf-field">
            <span>{t("booking.length")}</span>
            <select value={form.duration_minutes} onChange={(e) => set({ duration_minutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {t("appt.minutes", { count: m })}
                </option>
              ))}
            </select>
          </label>
          <label className="pf-field">
            <span>{t("booking.buffer")}</span>
            <select value={form.buffer_minutes} onChange={(e) => set({ buffer_minutes: Number(e.target.value) })}>
              {[0, 5, 10, 15, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {t("appt.minutes", { count: m })}
                </option>
              ))}
            </select>
          </label>
          <label className="pf-field">
            <span>{t("booking.notice")}</span>
            <select value={form.min_notice_hours} onChange={(e) => set({ min_notice_hours: Number(e.target.value) })}>
              {[0, 1, 2, 4, 12, 24, 48].map((h) => (
                <option key={h} value={h}>
                  {t("booking.hours", { count: h })}
                </option>
              ))}
            </select>
          </label>
          <label className="pf-field">
            <span>{t("booking.horizon")}</span>
            <select value={form.advance_days} onChange={(e) => set({ advance_days: Number(e.target.value) })}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {t("booking.days", { count: d })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="pf-form-grid">
          <label className="pf-field">
            <span>{t("booking.titleEn")}</span>
            <input value={form.title_en} maxLength={200} onChange={(e) => set({ title_en: e.target.value })} />
          </label>
          <label className="pf-field">
            <span>{t("booking.titleEs")}</span>
            <input value={form.title_es} maxLength={200} onChange={(e) => set({ title_es: e.target.value })} />
          </label>
        </div>
        <fieldset className="gw-booking-types">
          <legend>{t("booking.types")}</legend>
          {(["onsite", "phone", "video", "office"] as const).map((k) => (
            <label key={k} className="gw-check">
              <input type="checkbox" checked={form[`allow_${k}`]} onChange={(e) => set({ [`allow_${k}`]: e.target.checked } as Partial<SchedulerSettings>)} />
              <span>{t(`appt.loc.${k}`)}</span>
            </label>
          ))}
        </fieldset>
        {form.allow_video ? (
          <label className="pf-field">
            <span>{t("booking.videoRoom")}</span>
            <input type="url" value={form.video_url || ""} placeholder="https://" onChange={(e) => set({ video_url: e.target.value || null })} />
          </label>
        ) : null}

        <fieldset className="gw-hours">
          <legend>{t("booking.hoursTitle", { tz: form.timezone.replace("_", " ") })}</legend>
          {DAYS.map((d) => {
            const list = ranges(d);
            return (
              <div key={d} className={cn("gw-hours__day", !list.length && "is-off")}>
                <label className="gw-check gw-hours__name">
                  <input type="checkbox" checked={list.length > 0} onChange={(e) => setRanges(d, e.target.checked ? [{ day_of_week: d, start_time: "09:00", end_time: "17:00" }] : [])} />
                  <span>{dayName(d)}</span>
                </label>
                <div className="gw-hours__ranges">
                  {list.length ? (
                    list.map((w, i) => (
                      <div key={i} className="gw-hours__range">
                        <input type="time" step={900} value={w.start_time} aria-label={t("booking.from")} onChange={(e) => setRanges(d, list.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))} />
                        <span aria-hidden>–</span>
                        <input type="time" step={900} value={w.end_time} aria-label={t("booking.to")} onChange={(e) => setRanges(d, list.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))} />
                        <button type="button" className="pf-btn pf-btn--sm" aria-label={t("booking.removeRange")} onClick={() => setRanges(d, list.filter((_, j) => j !== i))}>
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </div>
                    ))
                  ) : (
                    <span className="pf-muted">{t("booking.unavailable")}</span>
                  )}
                  {list.length ? (
                    <button type="button" className="pf-btn pf-btn--sm" onClick={() => setRanges(d, [...list, { day_of_week: d, start_time: "13:00", end_time: "17:00" }])}>
                      <Plus size={13} aria-hidden /> {t("booking.addRange")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </fieldset>
        <div className="pf-actions">
          <BusyButton tone="gold" label={t("pf.save")} busy={mineSaving} onClick={save} />
        </div>

        <fieldset className="gw-hours">
          <legend>
            <CalendarOff size={14} aria-hidden /> {t("booking.daysOff")}
          </legend>
          <div className="gw-block-form">
            <input type="date" value={block.from} aria-label={t("booking.from")} onChange={(e) => setBlock({ ...block, from: e.target.value })} />
            <input type="date" value={block.to} aria-label={t("booking.to")} onChange={(e) => setBlock({ ...block, to: e.target.value })} />
            <input value={block.label} placeholder={t("booking.blockLabel")} maxLength={200} onChange={(e) => setBlock({ ...block, label: e.target.value })} />
            <button
              type="button"
              className="pf-btn pf-btn--sm"
              disabled={!block.from}
              onClick={() =>
                void dispatch(addBlockedRange({ from_date: block.from, to_date: block.to || block.from, label: block.label })).then(() => {
                  setBlock({ from: "", to: "", label: "" });
                  void dispatch(fetchMyScheduler());
                })
              }
            >
              <Plus size={13} aria-hidden /> {t("booking.block")}
            </button>
          </div>
          <ul className="gw-block-list">
            {(mine?.blocked || []).map((b) => (
              <li key={b.id}>
                <span>
                  {b.starts_at ? new Date(b.starts_at).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { timeZone: form.timezone, month: "short", day: "numeric" }) : ""}
                  {" – "}
                  {b.ends_at ? new Date(b.ends_at).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { timeZone: form.timezone, month: "short", day: "numeric" }) : ""}
                  {b.label ? ` · ${b.label}` : ""}
                </span>
                <button type="button" className="pf-btn pf-btn--sm" aria-label={t("booking.unblock")} onClick={() => void dispatch(removeBlockedRange(b.id)).then(() => void dispatch(fetchMyScheduler()))}>
                  <Trash2 size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
    </section>
  );
}
