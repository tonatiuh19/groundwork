/**
 * Searchable client picker for linking unknown conversation threads.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Search, X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminClients } from "@/store/slices/adminPortalSlice";
import { useDebounce } from "@/hooks/useDebounce";
import type { AdminClient } from "@shared/api";

type Props = {
  value: AdminClient | null;
  onChange: (client: AdminClient | null) => void;
  disabled?: boolean;
};

export function ConversationLinkClientPicker({
  value,
  onChange,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const clients = useAppSelector((s) => s.adminPortal.clients.items);
  const loading = useAppSelector((s) => s.adminPortal.clients.loading);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounce(query, 280);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 1) return;
    void dispatch(fetchAdminClients({ q, limit: 8 }));
  }, [debounced, dispatch]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (value) {
    const label =
      `${value.first_name || ""} ${value.last_name || ""}`.trim() ||
      value.email ||
      value.phone ||
      `#${value.id}`;
    return (
      <div className="gw-conv-link-picker__selected">
        <span title={label}>{label}</span>
        <button
          type="button"
          className="pf-icon-btn"
          disabled={disabled}
          aria-label={t("conversations.clearLinkClient")}
          onClick={() => onChange(null)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const showMenu = open && query.trim().length > 0;

  return (
    <div className="gw-conv-link-picker" ref={containerRef}>
      <label className="gw-conv-search" style={{ margin: 0 }}>
        <Search className="w-3.5 h-3.5 shrink-0 opacity-60" aria-hidden />
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder={t("conversations.linkClientSearch")}
          aria-label={t("conversations.linkClientSearch")}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 spin shrink-0" aria-hidden />
        ) : null}
      </label>
      {showMenu ? (
        <ul className="gw-conv-link-picker__menu" role="listbox">
          {clients.length === 0 && !loading ? (
            <li>
              <button type="button" disabled>
                {t("conversations.linkClientNoMatches")}
              </button>
            </li>
          ) : (
            clients.map((c) => {
              const name =
                `${c.first_name || ""} ${c.last_name || ""}`.trim() ||
                t("conversations.kind.client");
              return (
                <li key={c.id} role="option">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(c);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <strong>{name}</strong>
                    <small>
                      {[c.phone, c.email].filter(Boolean).join(" · ") ||
                        `#${c.id}`}
                    </small>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
