import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarClock, CheckCircle2, Mail, PauseCircle, PlayCircle, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import type { Mailbox, MailboxAccessEntry, MailboxSaveBody } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearMailErrors, deleteMailbox, fetchMailStatus, fetchManagedMailboxes, saveMailbox, syncMailboxNow } from "@/store/slices/mailSlice";
import { fetchAdminAssignees } from "@/store/slices/adminPortalSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { SideDrawer } from "@/components/portal/SideDrawer";
import { Modal } from "@/components/portal/Modal";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import RichEditor from "./RichEditor";
import { cn } from "@/lib/cn";
import { formatRelative } from "./mailFormat";

type Draft = Required<Pick<MailboxSaveBody, "display_name" | "kind" | "mail_sync_enabled" | "calendar_sync_enabled">> & {
  email: string;
  owner_admin_id: number | null;
  signature_html: string | null;
  access: MailboxAccessEntry[];
};
const blank: Draft = { email: "", display_name: "", kind: "personal", owner_admin_id: null, mail_sync_enabled: true, calendar_sync_enabled: true, signature_html: null, access: [] };

/** Admin: connect Microsoft 365 mailboxes, who sees them, sync status, signature, pause / disconnect. */
export default function MailboxesDrawer({ open, onClose, configured, domains }: { open: boolean; onClose: () => void; configured: boolean; domains: string[] }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { managed, managedLoading, savingMailbox, mailboxError, syncing } = useAppSelector((s) => s.mail);
  const staff = useAppSelector((s) => s.adminPortal.assignees.items);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [sigKey, setSigKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<Mailbox | null>(null);

  useEffect(() => {
    if (!open) return;
    dispatch(clearMailErrors());
    void dispatch(fetchManagedMailboxes());
    void dispatch(fetchAdminAssignees());
    setEditing(null);
  }, [open, dispatch]);

  const staffItems = useMemo(() => staff.map((s) => ({ id: s.id, label: `${s.first_name} ${s.last_name}`.trim(), sub: s.email })), [staff]);
  const startEdit = (m: Mailbox | null) => {
    dispatch(clearMailErrors());
    setDraft(
      m
        ? {
            email: m.email,
            display_name: m.display_name || "",
            kind: m.kind,
            owner_admin_id: m.owner_admin_id,
            mail_sync_enabled: m.mail_sync_enabled,
            calendar_sync_enabled: m.calendar_sync_enabled,
            signature_html: m.signature_html,
            access: m.access ?? [],
          }
        : { ...blank, email: domains[0] && domains[0] !== "*" ? `@${domains[0]}` : "" },
    );
    setSigKey((k) => k + 1);
    setEditing(m ? m.id : "new");
  };

  const refreshAll = () => {
    void dispatch(fetchManagedMailboxes());
    void dispatch(fetchMailStatus());
  };
  const save = async () => {
    const body: MailboxSaveBody = {
      display_name: draft.display_name || null,
      kind: draft.kind,
      owner_admin_id: draft.kind === "personal" ? draft.owner_admin_id : null,
      mail_sync_enabled: draft.mail_sync_enabled,
      calendar_sync_enabled: draft.kind === "personal" && draft.calendar_sync_enabled,
      signature_html: draft.signature_html,
      access: draft.access,
      ...(editing === "new" ? { email: draft.email.trim() } : {}),
    };
    const r = await dispatch(saveMailbox({ id: editing === "new" ? null : (editing as number), body }));
    if (saveMailbox.fulfilled.match(r)) {
      setEditing(null);
      void dispatch(fetchMailStatus());
    }
  };

  const statusChip = (m: Mailbox) =>
    m.status === "paused" ? (
      <span className="gw-mbx__chip is-muted">{t("mail.status.paused")}</span>
    ) : m.status === "error" || m.last_error ? (
      <span className="gw-mbx__chip is-bad">
        <AlertTriangle size={12} aria-hidden /> {t("mail.status.error")}
      </span>
    ) : (
      <span className="gw-mbx__chip is-good">
        <CheckCircle2 size={12} aria-hidden /> {t("mail.status.active")}
      </span>
    );

  const form = editing !== null && (
    <div className="gw-mbx-form">
      <ErrorNote error={mailboxError} />
      {editing === "new" ? (
        <label className="pf-field">
          <span>{t("mail.manage.email")}</span>
          <input type="email" value={draft.email} autoFocus inputMode="email" placeholder={`name@${domains.find((d) => d !== "*") || "groundworkcapitalgroup.com"}`} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <small className="pf-hint">{domains.includes("*") ? t("mail.manage.emailHintAny") : t("mail.manage.emailHint", { domains: domains.join(", ") })}</small>
        </label>
      ) : (
        <p className="gw-mbx-form__email">
          <Mail size={15} aria-hidden /> {draft.email}
        </p>
      )}
      <label className="pf-field">
        <span>{t("mail.manage.displayName")}</span>
        <input value={draft.display_name} maxLength={200} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
      </label>
      <div className="gw-seg" role="radiogroup" aria-label={t("mail.manage.kind")}>
        {(["personal", "shared"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={draft.kind === k} className={cn("gw-seg__opt", draft.kind === k && "is-on")} onClick={() => setDraft({ ...draft, kind: k })}>
            {t(`mail.manage.kind_${k}`)}
          </button>
        ))}
      </div>
      <p className="pf-hint">{t(`mail.manage.kindHint_${draft.kind}`)}</p>
      {draft.kind === "personal" ? (
        <label className="pf-field">
          <span>{t("mail.manage.owner")}</span>
          <select value={draft.owner_admin_id ?? ""} onChange={(e) => setDraft({ ...draft, owner_admin_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t("mail.manage.pickOwner")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.first_name} ${s.last_name}`.trim()} · {s.email}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="gw-check">
        <input type="checkbox" checked={draft.mail_sync_enabled} onChange={(e) => setDraft({ ...draft, mail_sync_enabled: e.target.checked })} />
        <span>{t("mail.manage.syncMail")}</span>
      </label>
      {draft.kind === "personal" ? (
        <label className="gw-check">
          <input type="checkbox" checked={draft.calendar_sync_enabled} onChange={(e) => setDraft({ ...draft, calendar_sync_enabled: e.target.checked })} />
          <span>{t("mail.manage.syncCalendar")}</span>
        </label>
      ) : null}
      <MultiSearchPicker
        icon={Users}
        label={t("mail.manage.access")}
        items={staffItems.filter((s) => s.id !== draft.owner_admin_id)}
        selected={draft.access.map((a) => a.admin_id)}
        onToggle={(id) =>
          setDraft({
            ...draft,
            access: draft.access.some((a) => a.admin_id === id) ? draft.access.filter((a) => a.admin_id !== id) : [...draft.access, { admin_id: id, can_send: true }],
          })
        }
        placeholder={t("mail.manage.accessSearch")}
      />
      <p className="pf-hint">{t("mail.manage.accessHint")}</p>
      {draft.access.length ? (
        <ul className="gw-mbx-access">
          {draft.access.map((a) => (
            <li key={a.admin_id}>
              <span>{staffItems.find((s) => s.id === a.admin_id)?.label || a.name || `#${a.admin_id}`}</span>
              <label className="gw-check">
                <input
                  type="checkbox"
                  checked={a.can_send}
                  onChange={(e) => setDraft({ ...draft, access: draft.access.map((x) => (x.admin_id === a.admin_id ? { ...x, can_send: e.target.checked } : x)) })}
                />
                <span>{t("mail.manage.canSend")}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="pf-field">
        <span>{t("mail.manage.signature")}</span>
        <RichEditor resetKey={sigKey} initialHtml={draft.signature_html || ""} onChange={(h) => setDraft((d) => ({ ...d, signature_html: h }))} ariaLabel={t("mail.manage.signature")} minHeight={90} />
      </div>
      <div className="pf-actions">
        <button type="button" className="pf-btn" onClick={() => setEditing(null)} disabled={savingMailbox}>
          {t("pf.cancel")}
        </button>
        <BusyButton
          tone="gold"
          label={editing === "new" ? t("mail.manage.connect") : t("mail.manage.save")}
          busyLabel={editing === "new" ? t("mail.manage.connecting") : t("appt.saving")}
          busy={savingMailbox}
          disabled={(editing === "new" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) || (draft.kind === "personal" && !draft.owner_admin_id)}
          onClick={() => void save()}
        />
      </div>
    </div>
  );

  return (
    <SideDrawer open={open} onClose={onClose} busy={savingMailbox} icon={<Mail size={18} />} title={t("mail.manage.title")} subtitle={t("mail.manage.subtitle")}>
      <div className="gw-mbx">
        {!configured ? (
          <div className="gw-mbx-setup">
            <h3>{t("mail.setup.title")}</h3>
            <ol>
              <li>{t("mail.setup.step1")}</li>
              <li>{t("mail.setup.step2")}</li>
              <li>{t("mail.setup.step3")}</li>
            </ol>
          </div>
        ) : null}
        {editing === "new" ? form : configured ? (
          <button type="button" className="pf-btn pf-btn--gold gw-mbx__add" onClick={() => startEdit(null)}>
            <Plus size={15} aria-hidden /> {t("mail.manage.add")}
          </button>
        ) : null}
        {editing !== "new" ? <ErrorNote error={mailboxError} /> : null}
        {managedLoading && !managed.length ? <p className="pf-muted">{t("pf.loading")}</p> : null}
        {!managedLoading && !managed.length && configured && editing !== "new" ? <p className="pf-muted">{t("mail.manage.none")}</p> : null}
        <ul className="gw-mbx__list">
          {managed.map((m) => (
            <li key={m.id} className={cn("gw-mbx__card", editing === m.id && "is-editing")}>
              <div className="gw-mbx__head">
                <span className="gw-mbx__avatar" aria-hidden>
                  {(m.display_name || m.email).slice(0, 1).toUpperCase()}
                </span>
                <div className="gw-mbx__who">
                  <strong>{m.display_name || m.email}</strong>
                  <small>
                    {m.email} · {m.kind === "shared" ? t("mail.manage.kind_shared") : m.owner_name || t("mail.manage.noOwner")}
                  </small>
                  <small className={cn("gw-mbx__auth", m.auth_mode === "delegated" && "is-delegated")}>
                    {m.auth_mode === "delegated" ? t("mail.manage.authDelegated") : t("mail.manage.authApp")}
                  </small>
                </div>
                {statusChip(m)}
              </div>
              <div className="gw-mbx__meta">
                <span>
                  <Mail size={12} aria-hidden /> {m.mail_sync_enabled ? (m.last_mail_sync_at ? formatRelative(m.last_mail_sync_at, i18n.language) : t("mail.manage.neverSynced")) : t("mail.manage.off")}
                </span>
                {m.kind === "personal" ? (
                  <span>
                    <CalendarClock size={12} aria-hidden />{" "}
                    {m.calendar_sync_enabled ? (m.last_calendar_sync_at ? formatRelative(m.last_calendar_sync_at, i18n.language) : t("mail.manage.neverSynced")) : t("mail.manage.off")}
                  </span>
                ) : null}
                {m.access?.length ? (
                  <span>
                    <Users size={12} aria-hidden /> {t("mail.manage.sharedWith", { count: m.access.length })}
                  </span>
                ) : null}
              </div>
              {m.last_error ? <p className="gw-mbx__error">{m.last_error}</p> : null}
              {editing === m.id ? (
                form
              ) : (
                <div className="gw-mbx__actions">
                  <button type="button" className="pf-btn pf-btn--sm" onClick={() => startEdit(m)}>
                    {t("mail.manage.edit")}
                  </button>
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    disabled={syncing === m.id || m.status === "paused"}
                    onClick={async () => {
                      await dispatch(syncMailboxNow(m.id));
                      refreshAll();
                    }}
                  >
                    <RefreshCw size={13} className={syncing === m.id ? "spin" : undefined} aria-hidden /> {t("mail.syncNow")}
                  </button>
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    disabled={savingMailbox}
                    onClick={async () => {
                      await dispatch(saveMailbox({ id: m.id, body: { status: m.status === "paused" ? "active" : "paused" } }));
                      void dispatch(fetchMailStatus());
                    }}
                  >
                    {m.status === "paused" ? <PlayCircle size={13} aria-hidden /> : <PauseCircle size={13} aria-hidden />}{" "}
                    {m.status === "paused" ? t("mail.manage.resume") : t("mail.manage.pause")}
                  </button>
                  <button type="button" className="pf-btn pf-btn--sm pf-btn--danger" onClick={() => setConfirmDelete(m)}>
                    <Trash2 size={13} aria-hidden /> {t("mail.manage.disconnect")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <Modal open={Boolean(confirmDelete)} titleKey="mail.manage.disconnectTitle" onClose={() => setConfirmDelete(null)}>
        <p>{t("mail.manage.disconnectBody", { email: confirmDelete?.email })}</p>
        <div className="pf-actions">
          <button type="button" className="pf-btn" onClick={() => setConfirmDelete(null)}>
            {t("pf.cancel")}
          </button>
          <BusyButton
            className="pf-btn--danger"
            label={t("mail.manage.disconnect")}
            busy={savingMailbox}
            onClick={async () => {
              if (!confirmDelete) return;
              const r = await dispatch(deleteMailbox(confirmDelete.id));
              if (deleteMailbox.fulfilled.match(r)) {
                setConfirmDelete(null);
                void dispatch(fetchMailStatus());
              }
            }}
          />
        </div>
      </Modal>
    </SideDrawer>
  );
}
