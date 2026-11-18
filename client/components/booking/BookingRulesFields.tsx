import { useTranslation } from "react-i18next";
import type { SchedulerSettings } from "@shared/api";

/** Rules shared by a personal booking link and a company booking page. */
export type BookingRules = Pick<
  SchedulerSettings,
  | "slug"
  | "duration_minutes"
  | "buffer_minutes"
  | "min_notice_hours"
  | "advance_days"
  | "title_en"
  | "title_es"
  | "allow_onsite"
  | "allow_phone"
  | "allow_video"
  | "allow_office"
  | "video_url"
  | "booking_types"
>;

/**
 * Link name, meeting length, buffer, notice, horizon, titles, meeting places, video room and the
 * extra call types. Used by Profile → My booking link and Settings → Company booking page.
 */
export default function BookingRulesFields<T extends BookingRules>({
  form,
  set,
  bookingUrl,
}: {
  form: T;
  set: (patch: Partial<T>) => void;
  bookingUrl?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="pf-form-grid">
        <label className="pf-field">
          <span>{t("booking.slug")}</span>
          <input value={form.slug} maxLength={60} onChange={(e) => set({ slug: e.target.value } as Partial<T>)} />
        </label>
        <label className="pf-field">
          <span>{t("booking.length")}</span>
          <select value={form.duration_minutes} onChange={(e) => set({ duration_minutes: Number(e.target.value) } as Partial<T>)}>
            {[15, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {t("appt.minutes", { count: m })}
              </option>
            ))}
          </select>
        </label>
        <label className="pf-field">
          <span>{t("booking.buffer")}</span>
          <select value={form.buffer_minutes} onChange={(e) => set({ buffer_minutes: Number(e.target.value) } as Partial<T>)}>
            {[0, 5, 10, 15, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {t("appt.minutes", { count: m })}
              </option>
            ))}
          </select>
        </label>
        <label className="pf-field">
          <span>{t("booking.notice")}</span>
          <select value={form.min_notice_hours} onChange={(e) => set({ min_notice_hours: Number(e.target.value) } as Partial<T>)}>
            {[0, 1, 2, 4, 12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {t("booking.hours", { count: h })}
              </option>
            ))}
          </select>
        </label>
        <label className="pf-field">
          <span>{t("booking.horizon")}</span>
          <select value={form.advance_days} onChange={(e) => set({ advance_days: Number(e.target.value) } as Partial<T>)}>
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
          <input value={form.title_en} maxLength={200} onChange={(e) => set({ title_en: e.target.value } as Partial<T>)} />
        </label>
        <label className="pf-field">
          <span>{t("booking.titleEs")}</span>
          <input value={form.title_es} maxLength={200} onChange={(e) => set({ title_es: e.target.value } as Partial<T>)} />
        </label>
      </div>
      <fieldset className="gw-booking-types">
        <legend>{t("booking.types")}</legend>
        {(["onsite", "phone", "video", "office"] as const).map((k) => (
          <label key={k} className="gw-check">
            <input type="checkbox" checked={form[`allow_${k}`]} onChange={(e) => set({ [`allow_${k}`]: e.target.checked } as Partial<T>)} />
            <span>{t(`appt.loc.${k}`)}</span>
          </label>
        ))}
      </fieldset>
      {form.allow_video ? (
        <label className="pf-field">
          <span>{t("booking.videoRoom")}</span>
          <input type="url" value={form.video_url || ""} placeholder="https://" onChange={(e) => set({ video_url: e.target.value || null } as Partial<T>)} />
          {!form.video_url ? <small className="pf-hint">{t("booking.videoAuto")}</small> : null}
        </label>
      ) : null}

      <fieldset className="gw-booking-types gw-booking-calltypes">
        <legend>{t("booking.typesTitle")}</legend>
        <p className="pf-hint">{t("booking.typesHint")}</p>
        {(["affiliate", "contractor"] as const).map((k) => {
          const bt = form.booking_types?.[k] ?? { enabled: false, duration_minutes: k === "affiliate" ? 20 : 30 };
          const setBt = (patch: Partial<typeof bt>) => set({ booking_types: { ...form.booking_types, [k]: { ...bt, ...patch } } } as Partial<T>);
          return (
            <div key={k} className="gw-booking-calltype">
              <label className="gw-check">
                <input type="checkbox" checked={bt.enabled} onChange={(e) => setBt({ enabled: e.target.checked })} />
                <span>{t(`booking.typeFor_${k}`)}</span>
              </label>
              <label className="pf-field gw-booking-calltype__len">
                <span>{t("booking.typeLength")}</span>
                <input type="number" min={15} max={240} step={5} value={bt.duration_minutes} disabled={!bt.enabled} onChange={(e) => setBt({ duration_minutes: Number(e.target.value) || 15 })} />
              </label>
              {bt.enabled && bookingUrl ? <code className="gw-booking-calltype__link">{`${bookingUrl}?type=${k}`}</code> : null}
            </div>
          );
        })}
      </fieldset>
    </>
  );
}
