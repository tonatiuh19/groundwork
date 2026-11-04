import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearRecordSearch, searchRecords } from "@/store/slices/recordsSlice";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/cn";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email recipients as chips. Type an address (Enter, comma or space adds it) or
 * pick a client / lead from the CRM by name.
 */
export default function RecipientInput({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const listId = useId();
  const inputId = useId();
  const { results } = useAppSelector((s) => s.records);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounce(q, 250);
  const blurTimer = useRef<number>();

  useEffect(() => {
    if (debounced.trim().length >= 2 && !debounced.includes("@")) void dispatch(searchRecords(debounced.trim()));
  }, [debounced, dispatch]);
  useEffect(() => () => void dispatch(clearRecordSearch()), [dispatch]);

  const suggestions = useMemo(() => {
    if (!results || q.trim().length < 2 || q.includes("@")) return [];
    const out: Array<{ email: string; label: string; kind: string }> = [];
    for (const c of results.clients) if (c.email) out.push({ email: c.email, label: c.name || c.email, kind: t("picker.kind.client") });
    for (const l of results.leads) if (l.email) out.push({ email: l.email, label: l.name || l.email, kind: t("picker.kind.lead") });
    return out.filter((o) => !value.includes(o.email.toLowerCase())).slice(0, 8);
  }, [results, q, value, t]);
  useEffect(() => setActive(0), [suggestions.length]);

  const add = (raw: string) => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    const good = parts.filter((p) => EMAIL_RE.test(p) && !value.includes(p));
    if (good.length) onChange([...value, ...good]);
    setQ(parts.filter((p) => !EMAIL_RE.test(p)).join(" "));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActive((a) => (e.key === "ArrowDown" ? Math.min(suggestions.length - 1, a + 1) : Math.max(0, a - 1)));
    } else if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === " " && q.includes("@"))) {
      if (open && suggestions.length && e.key === "Enter" && !q.includes("@")) {
        e.preventDefault();
        onChange([...value, suggestions[active].email.toLowerCase()]);
        setQ("");
        return;
      }
      if (q.trim()) {
        e.preventDefault();
        add(q);
      }
    } else if (e.key === "Backspace" && !q && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="gw-rcpt">
      <label className="gw-rcpt__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="gw-rcpt__box">
        {value.map((e) => (
          <span key={e} className="gw-rcpt__chip">
            {e}
            <button type="button" aria-label={t("picker.remove", { name: e })} onClick={() => onChange(value.filter((x) => x !== e))}>
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={q}
          inputMode="email"
          autoComplete="off"
          placeholder={value.length ? "" : t("mail.recipientPlaceholder")}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => {
              setOpen(false);
              if (q.trim()) add(q);
            }, 150);
          }}
          onKeyDown={onKeyDown}
        />
        {open && suggestions.length ? (
          <ul className="gw-sp__list gw-rcpt__list" id={listId} role="listbox" onMouseDown={() => window.clearTimeout(blurTimer.current)}>
            {suggestions.map((s, i) => (
              <li
                key={`${s.email}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn("gw-sp__opt", i === active && "is-active")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange([...value, s.email.toLowerCase()]);
                  setQ("");
                }}
              >
                <span className="gw-sp__avatar" aria-hidden>
                  {s.label.slice(0, 1).toUpperCase()}
                </span>
                <span className="gw-sp__opt-text">
                  <strong>{s.label}</strong>
                  <small>
                    {s.kind} · {s.email}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
