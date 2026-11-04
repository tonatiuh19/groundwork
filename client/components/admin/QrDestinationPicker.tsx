import { useEffect, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QrDestinationInput, QrDestinationType } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQrDestinations } from "@/store/slices/qrLinksSlice";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/cn";

const TYPES: QrDestinationType[] = ["page", "event", "next_event", "affiliate", "external"];

export type QrPicked = QrDestinationInput & { label?: string };

/** Readable name for a destination: page keys are translated, records use their own name. */
export function useQrDestLabel() {
  const { t } = useTranslation();
  return (d: { type: QrDestinationType; key?: string | null; label?: string } | null | undefined) => {
    if (!d) return "";
    if (d.type === "page" && d.key) return t(`qrCodes.page_${d.key}`);
    return d.label || t(`qrCodes.type_${d.type}`);
  };
}

/**
 * Destination picker: choose a kind, then search real records. Nothing is typed, so a printed code
 * can only ever point at something that exists. `clearable` adds "Home page" (the fallback default).
 */
export default function QrDestinationPicker({
  label,
  value,
  onChange,
  disabled,
  clearable,
}: {
  label: string;
  value: QrPicked | null;
  onChange: (v: QrPicked | null) => void;
  disabled?: boolean;
  clearable?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { options, optionsLoading } = useAppSelector((s) => s.qrLinks);
  const labelOf = useQrDestLabel();
  // "" = no destination kind chosen: the fallback default, home page.
  const [type, setType] = useState<QrDestinationType | "">(value?.type || (clearable ? "" : "page"));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);

  useEffect(() => {
    if (value?.type) setType(value.type);
  }, [value?.type]);
  useEffect(() => {
    if (!open || !type || type === "next_event") return;
    void dispatch(fetchQrDestinations(type === "page" ? { type } : { type, q: dq }));
  }, [dispatch, open, type, dq]);

  const shown =
    type === "page"
      ? options
          .map((o) => ({ ...o, label: t(`qrCodes.page_${o.value}`) }))
          .filter((o) => `${o.label} ${o.sub || ""}`.toLowerCase().includes(q.trim().toLowerCase()))
      : options;
  const changeType = (next: QrDestinationType | "") => {
    setQ("");
    setOpen(false);
    setType(next);
    onChange(next === "next_event" ? { type: next } : null);
  };

  return (
    <div className="gw-qr-pick">
      <span className="gw-qr-pick__label">{label}</span>
      <select
        aria-label={t("qrCodes.kindAria", { label })}
        value={type}
        disabled={disabled}
        onChange={(e) => changeType(e.target.value as QrDestinationType | "")}
      >
        {clearable ? <option value="">{t("qrCodes.page_home")}</option> : null}
        {TYPES.map((x) => (
          <option key={x} value={x}>
            {t(`qrCodes.type_${x}`)}
          </option>
        ))}
      </select>
      {!type ? null : type === "next_event" ? (
        <p className="pf-hint">{t("qrCodes.nextEventHint")}</p>
      ) : value && value.type === type ? (
        <div className="gw-qr-pick__chosen">
          <Check size={15} aria-hidden />
          <span>{labelOf(value)}</span>
          {!disabled ? (
            <button type="button" aria-label={t("picker.clear")} onClick={() => onChange(null)}>
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : !disabled ? (
        <div className={cn("gw-sp__field", open && "is-open")}>
          <Search size={15} aria-hidden />
          <input
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            value={q}
            placeholder={t(`qrCodes.search_${type}`)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          />
          {open ? (
            <ul className="gw-sp__list" role="listbox">
              {optionsLoading && !shown.length ? (
                <li className="gw-sp__opt">
                  <Loader2 className="spin" size={14} aria-hidden /> {t("picker.searching")}
                </li>
              ) : null}
              {!optionsLoading && !shown.length ? <li className="gw-sp__opt">{t("picker.noMatches")}</li> : null}
              {shown.map((o) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={false}
                  className="gw-sp__opt gw-qr-pick__opt"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(type === "page" ? { type, key: o.value, label: o.label } : { type, id: Number(o.value), label: o.label });
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <strong>{o.label}</strong>
                  {o.sub ? <small>{o.sub}</small> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
