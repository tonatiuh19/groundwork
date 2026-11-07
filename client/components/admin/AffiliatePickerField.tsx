import { useEffect, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { useField } from "formik";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQrDestinations } from "@/store/slices/qrLinksSlice";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/cn";

/**
 * One active affiliate for a record (e.g. an event's host): searched and picked, never typed.
 * Formik field `name` holds the id ("" = none); `initialLabel` names the saved affiliate.
 * Reuses the admin affiliate search behind QR code destinations (active affiliates only).
 */
export default function AffiliatePickerField({
  name,
  label,
  initialLabel,
  noneLabel,
  disabled,
}: {
  name: string;
  label: string;
  initialLabel?: string | null;
  noneLabel: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { options, optionsLoading } = useAppSelector((s) => s.qrLinks);
  const [field, , helpers] = useField<string>(name);
  const [picked, setPicked] = useState<string | null>(initialLabel || null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);

  useEffect(() => setPicked(initialLabel || null), [initialLabel]);
  useEffect(() => {
    if (open) void dispatch(fetchQrDestinations({ type: "affiliate", q: dq }));
  }, [dispatch, open, dq]);

  return (
    <div className="gw-qr-pick">
      <span className="gw-qr-pick__label">{label}</span>
      {field.value ? (
        <div className="gw-qr-pick__chosen">
          <Check size={15} aria-hidden />
          <span>{picked || `#${field.value}`}</span>
          {!disabled ? (
            <button
              type="button"
              aria-label={t("picker.clear")}
              onClick={() => {
                void helpers.setValue("");
                setPicked(null);
              }}
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : disabled ? (
        <p className="pf-muted">{noneLabel}</p>
      ) : (
        <div className={cn("gw-sp__field", open && "is-open")}>
          <Search size={15} aria-hidden />
          <input
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            value={q}
            placeholder={t("qrCodes.search_affiliate")}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          />
          {open ? (
            <ul className="gw-sp__list" role="listbox">
              {optionsLoading && !options.length ? (
                <li className="gw-sp__opt">
                  <Loader2 className="spin" size={14} aria-hidden /> {t("picker.searching")}
                </li>
              ) : null}
              {!optionsLoading && !options.length ? <li className="gw-sp__opt">{t("picker.noMatches")}</li> : null}
              {options.map((o) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={false}
                  className="gw-sp__opt gw-qr-pick__opt"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void helpers.setValue(String(o.value));
                    setPicked(o.label);
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
      )}
    </div>
  );
}
