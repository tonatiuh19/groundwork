import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchBookingSlots } from "@/store/slices/bookingSlice";
import { Loading } from "@/components/portal/kit";
import { addDays, slotLabel, todayIn } from "@/lib/apptTime";
import { cn } from "@/lib/cn";

/**
 * Two-week date strip (only weekdays the host works) + open times for the
 * picked day. Times are the host's timezone (shown under the grid).
 */
export default function SlotPicker({
  slug,
  timezone,
  days,
  advanceDays,
  value,
  onChange,
}: {
  slug: string;
  timezone: string;
  days: number[];
  advanceDays: number;
  value: { date: string; time: string } | null;
  onChange: (v: { date: string; time: string }) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const dispatch = useAppDispatch();
  const { slots, slotsLoading } = useAppSelector((s) => s.booking);
  const today = todayIn(timezone);
  const [offset, setOffset] = useState(0);
  const window14 = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => addDays(today, offset + i)).filter(
        (d) => days.includes(new Date(`${d}T12:00:00Z`).getUTCDay()) && d <= addDays(today, advanceDays),
      ),
    [today, offset, days, advanceDays],
  );
  const [date, setDate] = useState<string | null>(value?.date ?? null);
  useEffect(() => {
    if (!date && window14[0]) setDate(window14[0]);
  }, [date, window14]);
  useEffect(() => {
    if (date && !slots[date]) void dispatch(fetchBookingSlots({ slug, date }));
  }, [date, slug, slots, dispatch]);

  const loc = lang === "es" ? "es-US" : "en-US";
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { ...o, timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const daySlots = date ? slots[date] : undefined;

  return (
    <div className="gw-slots">
      <div className="gw-slots__days">
        <button type="button" className="gw-slots__nav" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 14))} aria-label={t("booking.earlier")}>
          <ChevronLeft size={16} aria-hidden />
        </button>
        <div className="gw-slots__strip" role="listbox" aria-label={t("booking.pickDay")}>
          {window14.map((d) => (
            <button
              key={d}
              type="button"
              role="option"
              aria-selected={date === d}
              className={cn("gw-slots__day", date === d && "is-on")}
              onClick={() => setDate(d)}
            >
              <span>{fmt(d, { weekday: "short" })}</span>
              <strong>{fmt(d, { day: "numeric" })}</strong>
              <span>{fmt(d, { month: "short" })}</span>
            </button>
          ))}
          {!window14.length ? <p className="pf-muted">{t("booking.noDays")}</p> : null}
        </div>
        <button
          type="button"
          className="gw-slots__nav"
          disabled={offset + 14 > advanceDays}
          onClick={() => setOffset(offset + 14)}
          aria-label={t("booking.later")}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>
      {date ? (
        <div className="gw-slots__times">
          <p className="gw-slots__heading">{fmt(date, { weekday: "long", month: "long", day: "numeric" })}</p>
          {slotsLoading && !daySlots ? <Loading /> : null}
          {daySlots && !daySlots.length ? <p className="pf-muted">{t("booking.noTimes")}</p> : null}
          <div className="gw-slots__grid">
            {(daySlots || []).map((time) => (
              <button
                key={time}
                type="button"
                className={cn("gw-slots__time", value?.date === date && value?.time === time && "is-on")}
                onClick={() => onChange({ date, time })}
              >
                {slotLabel(time, lang)}
              </button>
            ))}
          </div>
          <p className="pf-hint">
            <Clock size={12} aria-hidden /> {t("booking.tzNote", { tz: timezone.replace("_", " ") })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
