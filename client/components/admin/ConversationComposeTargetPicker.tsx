/**
 * Unified recipient picker: search clients + CRM contacts OR enter a raw phone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Phone, Search, X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminClients } from "@/store/slices/adminPortalSlice";
import { fetchAdminContacts } from "@/store/slices/contactsSlice";
import { useDebounce } from "@/hooks/useDebounce";
import { parseComposePhoneInput } from "@/lib/parseComposePhone";
import type { AdminClient, CrmContact } from "@shared/api";

export { parseComposePhoneInput } from "@/lib/parseComposePhone";

export type ConversationComposeTarget =
  | { kind: "client"; client: AdminClient }
  | { kind: "contact"; contact: CrmContact }
  | { kind: "phone"; phone: string; label: string };

interface Props {
  value: ConversationComposeTarget | null;
  onChange: (target: ConversationComposeTarget | null) => void;
  disabled?: boolean;
}

function Initials({ first, last }: { first: string; last: string }) {
  return (
    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 select-none">
      {(first[0] ?? "").toUpperCase()}
      {(last[0] ?? "").toUpperCase()}
    </div>
  );
}

function looksLikePhoneQuery(q: string): boolean {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const nonDigitRatio = (q.length - digits.length) / Math.max(q.length, 1);
  return nonDigitRatio < 0.45;
}

export function ConversationComposeTargetPicker({
  value,
  onChange,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const clients = useAppSelector((s) => s.adminPortal.clients.items);
  const clientsLoading = useAppSelector((s) => s.adminPortal.clients.loading);
  const contacts = useAppSelector((s) => s.contacts.contacts);
  const contactsLoading = useAppSelector((s) => s.contacts.loading);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debouncedQuery = useDebounce(query, 280);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 1) return;
    void dispatch(fetchAdminClients({ q, limit: 8 }));
    void dispatch(fetchAdminContacts({ search: q, limit: 8 }));
  }, [debouncedQuery, dispatch]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setActiveIdx(-1);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const phoneOption = useMemo(() => {
    if (!looksLikePhoneQuery(query)) return null;
    return parseComposePhoneInput(query);
  }, [query]);

  type Row =
    | { type: "phone"; phone: string; label: string }
    | { type: "client"; client: AdminClient }
    | { type: "contact"; contact: CrmContact };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (phoneOption) {
      out.push({
        type: "phone",
        phone: phoneOption.phone,
        label: phoneOption.label,
      });
    }
    for (const c of contacts) out.push({ type: "contact", contact: c });
    for (const c of clients) out.push({ type: "client", client: c });
    return out;
  }, [phoneOption, clients, contacts]);

  const selectRow = useCallback(
    (row: Row) => {
      if (row.type === "phone") {
        onChange({ kind: "phone", phone: row.phone, label: row.label });
      } else if (row.type === "contact") {
        onChange({ kind: "contact", contact: row.contact });
      } else {
        onChange({ kind: "client", client: row.client });
      }
      setQuery("");
      setOpen(false);
      setActiveIdx(-1);
    },
    [onChange],
  );

  const clearSelection = useCallback(() => {
    onChange(null);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onChange]);

  const searching = clientsLoading || contactsLoading;
  const showDropdown = open && query.trim().length >= 1;

  if (value) {
    return (
      <div className="gw-compose-target gw-compose-target--selected">
        {value.kind === "client" ? (
          <>
            <Initials
              first={value.client.first_name}
              last={value.client.last_name}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {value.client.first_name} {value.client.last_name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {value.client.phone || value.client.email}
              </p>
            </div>
            {value.client.status === "prospect" && (
              <span className="gw-chip gw-chip--accent">
                {t("conversations.prospectBadge")}
              </span>
            )}
          </>
        ) : value.kind === "contact" ? (
          <>
            <Initials
              first={value.contact.first_name}
              last={value.contact.last_name}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {value.contact.first_name} {value.contact.last_name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {value.contact.phone || value.contact.email}
              </p>
            </div>
            <span className="gw-chip">{t("conversations.contactBadge")}</span>
          </>
        ) : (
          <>
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Phone className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{value.label}</p>
              <p className="text-xs text-muted-foreground truncate">
                {t("conversations.composeNewNumberHint")}
              </p>
            </div>
          </>
        )}
        {!disabled && (
          <button
            type="button"
            onClick={clearSelection}
            className="pf-icon-btn"
            aria-label={t("conversations.clearRecipient")}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="gw-compose-target">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="search"
          className="gw-compose-target__input"
          placeholder={t("conversations.composeTargetPlaceholder")}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActiveIdx((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (activeIdx >= 0 && rows[activeIdx]) selectRow(rows[activeIdx]);
              else if (phoneOption) {
                selectRow({
                  type: "phone",
                  phone: phoneOption.phone,
                  label: phoneOption.label,
                });
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          autoComplete="off"
        />
        {searching && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {showDropdown && (
        <ul
          ref={listRef}
          className="gw-compose-target__menu"
          role="listbox"
        >
          {rows.length === 0 && !searching && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {t("conversations.composeNoMatches")}
            </li>
          )}
          {rows.map((row, idx) => {
            const active = idx === activeIdx;
            const key =
              row.type === "phone"
                ? `p:${row.phone}`
                : row.type === "client"
                  ? `c:${row.client.id}`
                  : `k:${row.contact.id}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={
                    active
                      ? "gw-compose-target__option is-active"
                      : "gw-compose-target__option"
                  }
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => selectRow(row)}
                >
                  {row.type === "phone" ? (
                    <>
                      <Phone className="w-4 h-4 shrink-0" />
                      <span className="truncate">
                        {t("conversations.composeUsePhone", {
                          phone: row.label,
                        })}
                      </span>
                    </>
                  ) : row.type === "client" ? (
                    <>
                      <Initials
                        first={row.client.first_name}
                        last={row.client.last_name}
                      />
                      <span className="min-w-0 truncate">
                        {row.client.first_name} {row.client.last_name}
                        <span className="text-muted-foreground">
                          {" "}
                          · {row.client.phone || row.client.email}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <Initials
                        first={row.contact.first_name}
                        last={row.contact.last_name}
                      />
                      <span className="min-w-0 truncate">
                        {row.contact.first_name} {row.contact.last_name}
                        <span className="text-muted-foreground">
                          {" "}
                          · {row.contact.phone || row.contact.email}
                        </span>
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
