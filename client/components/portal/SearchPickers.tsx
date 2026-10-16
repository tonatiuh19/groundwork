import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, FolderKanban, Inbox, Loader2, Search, User, X, type LucideIcon } from "lucide-react";
import type { RecordRef } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearRecordSearch, searchRecords } from "@/store/slices/recordsSlice";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/cn";

type Option = { id: number; label: string; sub?: string | null };

/** Shared combobox shell: input + listbox with keyboard support (↑ ↓ Enter Esc). */
function useCombo(count: number, onPick: (i: number) => void) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [count]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(count - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && open && count) {
      e.preventDefault();
      onPick(active);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };
  return { open, setOpen, active, setActive, onKeyDown };
}

/**
 * Multi-select search picker (team, contractors, lenders…): selected people as
 * removable chips, type to filter, pick from the dropdown. Scales to long lists
 * and works the same on phones and desktop.
 */
export function MultiSearchPicker({
  icon: Icon,
  label,
  items,
  selected,
  onToggle,
  empty,
  placeholder,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  items: Option[];
  selected: number[];
  onToggle: (id: number) => void;
  empty?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [q, setQ] = useState("");
  const blurTimer = useRef<number>();
  const chosen = items.filter((i) => selected.includes(i.id));
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    return items.filter((i) => !selected.includes(i.id) && (!n || `${i.label} ${i.sub || ""}`.toLowerCase().includes(n))).slice(0, 30);
  }, [items, selected, q]);
  const combo = useCombo(matches.length, (i) => {
    onToggle(matches[i].id);
    setQ("");
  });

  return (
    <div className="gw-sp">
      <span className="gw-tag-group__label">
        <Icon size={14} aria-hidden /> {label}
      </span>
      {chosen.length ? (
        <div className="gw-sp__chips">
          {chosen.map((c) => (
            <span key={c.id} className="gw-sp__chip">
              <span className="gw-sp__avatar" aria-hidden>
                {c.label.slice(0, 1).toUpperCase()}
              </span>
              <span className="gw-sp__chip-text">{c.label}</span>
              {!disabled ? (
                <button type="button" aria-label={t("picker.remove", { name: c.label })} onClick={() => onToggle(c.id)}>
                  <X size={13} aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {!items.length ? (
        <p className="pf-hint">{empty}</p>
      ) : !disabled ? (
        <div className={cn("gw-sp__field", combo.open && "is-open")}>
          <Search size={15} aria-hidden />
          <input
            role="combobox"
            aria-expanded={combo.open}
            aria-controls={listId}
            aria-autocomplete="list"
            value={q}
            placeholder={placeholder || t("picker.search")}
            onChange={(e) => {
              setQ(e.target.value);
              combo.setOpen(true);
            }}
            onFocus={(e) => {
              combo.setOpen(true);
              // Give the dropdown room (bottom of drawers, phones with the keyboard up).
              e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
            onBlur={() => (blurTimer.current = window.setTimeout(() => combo.setOpen(false), 120))}
            onKeyDown={combo.onKeyDown}
          />
          {combo.open ? (
            <ul className="gw-sp__list" id={listId} role="listbox" onMouseDown={() => window.clearTimeout(blurTimer.current)}>
              {matches.length ? (
                matches.map((m, i) => (
                  <li
                    key={m.id}
                    role="option"
                    aria-selected={i === combo.active}
                    className={cn("gw-sp__opt", i === combo.active && "is-active")}
                    onMouseEnter={() => combo.setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onToggle(m.id);
                      setQ("");
                    }}
                  >
                    <span className="gw-sp__avatar" aria-hidden>
                      {m.label.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="gw-sp__opt-text">
                      <strong>{m.label}</strong>
                      {m.sub ? <small>{m.sub}</small> : null}
                    </span>
                    <Check size={14} className="gw-sp__opt-add" aria-hidden />
                  </li>
                ))
              ) : (
                <li className="gw-sp__none">{t("picker.noMatches")}</li>
              )}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const KIND_ICON: Record<RecordRef["kind"], LucideIcon> = { client: User, lead: Inbox, project: FolderKanban };

/**
 * Global search for "who is this for": one box that finds clients, leads and
 * projects by name, email, phone, address or project id — grouped results,
 * keyboard friendly, selected record shown as a card you can clear.
 */
export function RecordPicker({
  value,
  onChange,
  label,
  hint,
  disabled,
}: {
  value: RecordRef | null;
  onChange: (v: RecordRef | null) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const listId = useId();
  const { results, searching } = useAppSelector((s) => s.records);
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 250);
  const blurTimer = useRef<number>();

  useEffect(() => {
    if (debounced.trim().length >= 2) void dispatch(searchRecords(debounced.trim()));
    else dispatch(clearRecordSearch());
  }, [debounced, dispatch]);

  const options: RecordRef[] = useMemo(() => {
    if (!results || q.trim().length < 2) return [];
    return [
      ...results.clients.map((c) => ({ kind: "client" as const, id: c.id, label: c.name || c.email || `#${c.id}`, sub: [c.email, c.phone, c.city].filter(Boolean).join(" · ") })),
      ...results.leads.map((l) => ({ kind: "lead" as const, id: l.id, label: l.name || l.email || `#${l.id}`, sub: [l.email, l.phone, l.address].filter(Boolean).join(" · ") })),
      ...results.projects.map((p) => ({ kind: "project" as const, id: p.id, label: `${p.public_id}${p.client_name ? ` · ${p.client_name}` : ""}`, sub: [p.address, t(`milestone.${p.milestone}`)].filter(Boolean).join(" · ") })),
    ];
  }, [results, q, t]);
  const pick = (o: RecordRef) => {
    onChange(o);
    setQ("");
    dispatch(clearRecordSearch());
  };
  const combo = useCombo(options.length, (i) => pick(options[i]));

  if (value) {
    const Icon = KIND_ICON[value.kind];
    return (
      <div className="gw-sp">
        <span className="gw-tag-group__label">{label}</span>
        <div className="gw-rp__selected">
          <span className={cn("gw-rp__icon", `is-${value.kind}`)} aria-hidden>
            <Icon size={16} />
          </span>
          <span className="gw-sp__opt-text">
            <strong>{value.label}</strong>
            <small>
              {t(`picker.kind.${value.kind}`)}
              {value.sub ? ` · ${value.sub}` : ""}
            </small>
          </span>
          {!disabled ? (
            <button type="button" className="gw-rp__clear" aria-label={t("picker.clear")} onClick={() => onChange(null)}>
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  let lastKind: string | null = null;
  return (
    <div className="gw-sp">
      <span className="gw-tag-group__label">{label}</span>
      <div className={cn("gw-sp__field gw-rp__field", combo.open && "is-open")}>
        {searching ? <Loader2 size={15} className="spin" aria-hidden /> : <Search size={15} aria-hidden />}
        <input
          role="combobox"
          aria-expanded={combo.open && q.trim().length >= 2}
          aria-controls={listId}
          aria-autocomplete="list"
          value={q}
          disabled={disabled}
          placeholder={t("picker.recordPlaceholder")}
          onChange={(e) => {
            setQ(e.target.value);
            combo.setOpen(true);
          }}
          onFocus={(e) => {
            combo.setOpen(true);
            e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" });
          }}
          onBlur={() => (blurTimer.current = window.setTimeout(() => combo.setOpen(false), 120))}
          onKeyDown={combo.onKeyDown}
        />
        {combo.open && q.trim().length >= 2 ? (
          <ul className="gw-sp__list" id={listId} role="listbox" onMouseDown={() => window.clearTimeout(blurTimer.current)}>
            {options.length ? (
              options.map((o, i) => {
                const Icon = KIND_ICON[o.kind];
                const header = o.kind !== lastKind ? t(`picker.group.${o.kind}`) : null;
                lastKind = o.kind;
                return (
                  <li key={`${o.kind}-${o.id}`} role="presentation">
                    {header ? <span className="gw-sp__group">{header}</span> : null}
                    <div
                      role="option"
                      aria-selected={i === combo.active}
                      className={cn("gw-sp__opt", i === combo.active && "is-active")}
                      onMouseEnter={() => combo.setActive(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(o);
                      }}
                    >
                      <span className={cn("gw-rp__icon", `is-${o.kind}`)} aria-hidden>
                        <Icon size={15} />
                      </span>
                      <span className="gw-sp__opt-text">
                        <strong>{o.label}</strong>
                        {o.sub ? <small>{o.sub}</small> : null}
                      </span>
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="gw-sp__none">{searching ? t("picker.searching") : t("picker.noMatches")}</li>
            )}
          </ul>
        ) : null}
      </div>
      {hint ? <p className="pf-hint">{hint}</p> : null}
    </div>
  );
}
