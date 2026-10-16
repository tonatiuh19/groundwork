import { useEffect, useMemo, useState } from "react";
import type { RecordRef } from "@shared/api";
import { MultiSearchPicker, RecordPicker } from "@/components/portal/SearchPickers";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  HardHat,
  Landmark,
  MapPin,
  Phone,
  Plus,
  UserPlus,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import {
  APPOINTMENT_KINDS,
  type Appointment,
  type AppointmentAttendeeInput,
  type AppointmentBody,
  type AppointmentKind,
  type AppointmentLocationType,
} from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminAssignees, fetchAdminContractors } from "@/store/slices/adminPortalSlice";
import {
  cancelAppointment,
  clearSchedulerErrors,
  fetchLenders,
  saveAppointment,
  setAppointmentStatus,
} from "@/store/slices/schedulerSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { SideDrawer } from "@/components/portal/SideDrawer";
import { EMPTY_LENDER, LenderEditor } from "@/components/admin/LendersPanel";
import { DEFAULT_TZ, formatApptRange, isoToZoned, minutesBetween, todayIn } from "@/lib/apptTime";
import { cn } from "@/lib/cn";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
const LOCATIONS: Array<{ v: AppointmentLocationType; icon: typeof MapPin }> = [
  { v: "onsite", icon: MapPin },
  { v: "office", icon: Building2 },
  { v: "phone", icon: Phone },
  { v: "video", icon: Video },
];

type Guest = { name: string; email: string; phone: string };

export type AppointmentContext = {
  client_id?: number | null;
  lead_id?: number | null;
  project_id?: number | null;
  /** Shown in the drawer header ("Kayla Gibson"). */
  label?: string | null;
  /** Prefill (e.g. clicked calendar day). */
  date?: string;
};

/**
 * Schedule / edit an appointment in a slide-over: type, time, place, and who
 * is tagged (staff, contractor, lender, guests) + homeowner confirmation.
 * Everyone tagged gets email + calendar invite + text; internal notes stay
 * with staff.
 */
export default function AppointmentDrawer({
  open,
  onClose,
  appointment,
  context,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  appointment?: Appointment | null;
  context?: AppointmentContext;
  onSaved?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.portalAuth.admin.user);
  const staff = useAppSelector((s) => s.adminPortal.assignees.items);
  const contractors = useAppSelector((s) => s.adminPortal.contractors.items);
  const lenders = useAppSelector((s) => s.scheduler.lenders);
  const { saving, saveError, conflicts } = useAppSelector((s) => s.scheduler);
  const editing = Boolean(appointment);
  const tz = appointment?.timezone || DEFAULT_TZ;

  const [kind, setKind] = useState<AppointmentKind>("property_inspection");
  const [date, setDate] = useState(todayIn(DEFAULT_TZ));
  const [start, setStart] = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [locType, setLocType] = useState<AppointmentLocationType>("onsite");
  const [location, setLocation] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [notifyHome, setNotifyHome] = useState(true);
  const [staffIds, setStaffIds] = useState<number[]>([]);
  const [contractorIds, setContractorIds] = useState<number[]>([]);
  const [lenderIds, setLenderIds] = useState<number[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [savedOnce, setSavedOnce] = useState(false);
  const [newLender, setNewLender] = useState<typeof EMPTY_LENDER | null>(null);
  // Calendar (no record page): staff pick who it's for with a global search.
  const [record, setRecord] = useState<RecordRef | null>(null);
  const pickRecord = !context?.client_id && !context?.lead_id && !context?.project_id;

  useEffect(() => {
    if (!open) return;
    dispatch(clearSchedulerErrors());
    setSavedOnce(false);
    setConfirmCancel(false);
    setCancelReason("");
    void dispatch(fetchAdminAssignees());
    void dispatch(fetchAdminContractors({ status: "active", limit: 100 }));
    void dispatch(fetchLenders());
    setRecord(
      appointment?.project_id
        ? { kind: "project", id: appointment.project_id, label: [appointment.project_public_id, appointment.client_name].filter(Boolean).join(" · ") }
        : appointment?.client_id
          ? { kind: "client", id: appointment.client_id, label: appointment.client_name || `#${appointment.client_id}` }
          : appointment?.lead_id
            ? { kind: "lead", id: appointment.lead_id, label: appointment.lead_name || `#${appointment.lead_id}` }
            : null,
    );
    if (appointment) {
      const z = isoToZoned(appointment.starts_at, appointment.timezone);
      setKind(appointment.kind);
      setDate(z.date);
      setStart(z.time);
      setDuration(minutesBetween(appointment.starts_at, appointment.ends_at));
      setLocType(appointment.location_type);
      setLocation(appointment.location || "");
      setVideoUrl(appointment.video_url || "");
      setTitle(appointment.title);
      setDescription(appointment.description || "");
      setNotes(appointment.notes || "");
      setNotifyHome(appointment.notify_homeowner);
      setStaffIds(appointment.attendees.filter((a) => a.kind === "admin" && a.admin_id).map((a) => a.admin_id!));
      setContractorIds(appointment.attendees.filter((a) => a.kind === "contractor" && a.contractor_id).map((a) => a.contractor_id!));
      setLenderIds(appointment.attendees.filter((a) => a.kind === "lender" && a.lender_id).map((a) => a.lender_id!));
      setGuests(appointment.attendees.filter((a) => a.kind === "guest").map((a) => ({ name: a.name || "", email: a.email || "", phone: a.phone || "" })));
    } else {
      setKind("property_inspection");
      setDate(context?.date || todayIn(DEFAULT_TZ));
      setStart("10:00");
      setDuration(60);
      setLocType("onsite");
      setLocation("");
      setVideoUrl("");
      setTitle("");
      setDescription("");
      setNotes("");
      setNotifyHome(true);
      setStaffIds(me?.id ? [me.id] : []);
      setContractorIds([]);
      setLenderIds([]);
      setGuests([]);
    }
  }, [open, appointment, context?.date, dispatch, me?.id]);

  const toggle = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const attendees: AppointmentAttendeeInput[] = useMemo(
    () => [
      ...staffIds.map((id) => ({ kind: "admin" as const, admin_id: id })),
      ...contractorIds.map((id) => ({ kind: "contractor" as const, contractor_id: id })),
      ...lenderIds.map((id) => ({ kind: "lender" as const, lender_id: id })),
      ...guests
        .filter((g) => g.name.trim() && (g.email.trim() || g.phone.trim()))
        .map((g) => ({ kind: "guest" as const, name: g.name.trim(), email: g.email.trim() || null, phone: g.phone.trim() || null })),
    ],
    [staffIds, contractorIds, lenderIds, guests],
  );
  const hasRecord = Boolean(record || context?.client_id || context?.lead_id || context?.project_id);

  const save = async () => {
    const body: Partial<AppointmentBody> = {
      kind,
      date,
      start,
      duration_minutes: duration,
      timezone: tz,
      location_type: locType,
      location: locType === "onsite" || locType === "office" ? location.trim() || null : null,
      video_url: locType === "video" ? videoUrl.trim() || null : null,
      title: title.trim() || undefined,
      description: description.trim() || null,
      notes: notes.trim() || null,
      notify_homeowner: hasRecord ? notifyHome : false,
      attendees,
      ...(pickRecord
        ? {
            client_id: record?.kind === "client" ? record.id : null,
            lead_id: record?.kind === "lead" ? record.id : null,
            project_id: record?.kind === "project" ? record.id : null,
          }
        : editing
          ? {}
          : {
              client_id: context?.client_id ?? null,
              lead_id: context?.lead_id ?? null,
              project_id: context?.project_id ?? null,
            }),
    };
    const r = await dispatch(saveAppointment({ id: appointment?.id ?? null, body }));
    if (saveAppointment.fulfilled.match(r)) {
      onSaved?.();
      // Keep the panel open once to show overlap warnings; otherwise close.
      if (r.payload.conflicts.length && !savedOnce) setSavedOnce(true);
      else onClose();
    }
  };

  const doCancel = async () => {
    if (!appointment) return;
    const r = await dispatch(cancelAppointment({ id: appointment.id, reason: cancelReason }));
    if (cancelAppointment.fulfilled.match(r)) {
      onSaved?.();
      onClose();
    }
  };

  const markStatus = async (status: "completed" | "no_show") => {
    if (!appointment) return;
    const r = await dispatch(setAppointmentStatus({ id: appointment.id, status }));
    if (setAppointmentStatus.fulfilled.match(r)) {
      onSaved?.();
      onClose();
    }
  };

  const cancelled = appointment?.status === "cancelled";
  const recordLabel = context?.label || appointment?.client_name || appointment?.lead_name || null;

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      busy={saving}
      icon={<CalendarClock size={18} />}
      title={editing ? t("appt.editTitle") : t("appt.newTitle")}
      subtitle={
        appointment
          ? formatApptRange(appointment.starts_at, appointment.ends_at, appointment.timezone, lang)
          : recordLabel || record?.label
            ? t("appt.forRecord", { name: recordLabel || record?.label })
            : t("appt.newLead")
      }
      footer={
        cancelled ? null : (
          <div className="gw-appt-foot">
            {editing ? (
              <div className="gw-appt-foot__left">
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => void markStatus("completed")} disabled={saving}>
                  <CheckCircle2 size={14} aria-hidden /> {t("appt.markDone")}
                </button>
                <button type="button" className="pf-btn pf-btn--sm pf-btn--danger" onClick={() => setConfirmCancel(true)} disabled={saving}>
                  <XCircle size={14} aria-hidden /> {t("appt.cancelAppt")}
                </button>
              </div>
            ) : null}
            <div className="pf-actions">
              <button type="button" className="pf-btn" onClick={onClose} disabled={saving}>
                {t("pf.close")}
              </button>
              <BusyButton
                tone="gold"
                icon={CalendarClock}
                label={editing ? t("appt.saveChanges") : t("appt.schedule")}
                busyLabel={t("appt.saving")}
                busy={saving}
                disabled={!date || !start}
                onClick={() => void save()}
              />
            </div>
          </div>
        )
      }
    >
      <div className="gw-appt-form">
        <ErrorNote error={saveError} />
        {conflicts.length && savedOnce ? (
          <div className="gw-appt-conflict" role="status">
            <AlertTriangle size={15} aria-hidden />
            <div>
              <strong>{t("appt.savedWithOverlap")}</strong>
              <ul>
                {conflicts.map((c) => (
                  <li key={c.id}>
                    {c.title} · {c.starts_at && c.ends_at ? formatApptRange(c.starts_at, c.ends_at, tz, lang) : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {cancelled ? <p className="gw-onboard-note">{t("appt.isCancelled", { reason: appointment?.cancelled_reason || "—" })}</p> : null}

        {confirmCancel ? (
          <div className="gw-appt-cancel" role="alertdialog" aria-label={t("appt.cancelAppt")}>
            <p>{t("appt.cancelLead")}</p>
            <label className="pf-field">
              <span>{t("appt.cancelReason")}</span>
              <input value={cancelReason} maxLength={300} onChange={(e) => setCancelReason(e.target.value)} />
            </label>
            <div className="pf-actions">
              <button type="button" className="pf-btn" onClick={() => setConfirmCancel(false)}>
                {t("appt.keep")}
              </button>
              <BusyButton className="pf-btn--danger" label={t("appt.confirmCancel")} busy={saving} onClick={() => void doCancel()} />
            </div>
          </div>
        ) : null}

        <section className="gw-drawer-section">
          <h3 className="gw-drawer-section__title">{t("appt.what")}</h3>
          <div className="gw-pick-row" role="radiogroup" aria-label={t("appt.what")}>
            {APPOINTMENT_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={cn("gw-pick", kind === k && "is-on")} onClick={() => setKind(k)} disabled={cancelled}>
                {t(`appt.kind.${k}`)}
              </button>
            ))}
          </div>
          <label className="pf-field">
            <span>{t("appt.titleOptional")}</span>
            <input value={title} maxLength={200} placeholder={t(`appt.kind.${kind}`)} onChange={(e) => setTitle(e.target.value)} disabled={cancelled} />
          </label>
        </section>

        <section className="gw-drawer-section">
          <h3 className="gw-drawer-section__title">{t("appt.when")}</h3>
          <div className="gw-appt-when">
            <label className="pf-field">
              <span>{t("appt.date")}</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={cancelled} />
            </label>
            <label className="pf-field">
              <span>{t("appt.start")}</span>
              <input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} disabled={cancelled} />
            </label>
            <label className="pf-field">
              <span>{t("appt.duration")}</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} disabled={cancelled}>
                {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? t("appt.minutes", { count: m }) : t("appt.hours", { count: m / 60 })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="pf-hint">{t("appt.tzHint", { tz: tz.replace("_", " ") })}</p>
        </section>

        <section className="gw-drawer-section">
          <h3 className="gw-drawer-section__title">{t("appt.where")}</h3>
          <div className="gw-seg" role="radiogroup" aria-label={t("appt.where")}>
            {LOCATIONS.map(({ v, icon: Icon }) => (
              <button key={v} type="button" role="radio" aria-checked={locType === v} className={cn("gw-seg__opt", locType === v && "is-on")} onClick={() => setLocType(v)} disabled={cancelled}>
                <Icon size={15} aria-hidden /> {t(`appt.loc.${v}`)}
              </button>
            ))}
          </div>
          {locType === "onsite" || locType === "office" ? (
            <label className="pf-field">
              <span>{t("appt.address")}</span>
              <input
                value={location}
                maxLength={500}
                placeholder={locType === "onsite" ? t("appt.addressDefault") : ""}
                onChange={(e) => setLocation(e.target.value)}
                disabled={cancelled}
              />
            </label>
          ) : null}
          {locType === "video" ? (
            <label className="pf-field">
              <span>{t("appt.videoUrl")}</span>
              <input type="url" value={videoUrl} maxLength={500} placeholder="https://" onChange={(e) => setVideoUrl(e.target.value)} disabled={cancelled} />
            </label>
          ) : null}
        </section>

        <section className="gw-drawer-section">
          <h3 className="gw-drawer-section__title">{t("appt.who")}</h3>
          {pickRecord ? (
            <RecordPicker value={record} onChange={setRecord} label={t("picker.forWho")} hint={t("picker.forWhoHint")} disabled={cancelled} />
          ) : null}
          <TagGroup
            icon={Users}
            label={t("appt.tagStaff")}
            items={staff.map((s) => ({ id: s.id, label: `${s.first_name} ${s.last_name}`.trim() }))}
            selected={staffIds}
            onToggle={(id) => toggle(staffIds, setStaffIds, id)}
            disabled={cancelled}
          />
          <TagGroup
            icon={HardHat}
            label={t("appt.tagContractor")}
            items={contractors.map((c) => ({ id: c.id, label: [`${c.first_name} ${c.last_name}`.trim(), c.company].filter(Boolean).join(" · ") }))}
            selected={contractorIds}
            onToggle={(id) => toggle(contractorIds, setContractorIds, id)}
            empty={t("appt.noContractors")}
            disabled={cancelled}
          />
          <TagGroup
            icon={Landmark}
            label={t("appt.tagLender")}
            items={lenders.filter((l) => l.is_active || lenderIds.includes(l.id)).map((l) => ({ id: l.id, label: [l.company, l.contact_name].filter(Boolean).join(" · ") }))}
            selected={lenderIds}
            onToggle={(id) => toggle(lenderIds, setLenderIds, id)}
            empty={t("appt.noLenders")}
            disabled={cancelled}
          />
          {!cancelled ? (
            <button type="button" className="pf-btn pf-btn--sm gw-quick-add" onClick={() => setNewLender({ ...EMPTY_LENDER })}>
              <Plus size={13} aria-hidden /> {t("lenders.add")}
            </button>
          ) : null}
          <div className="gw-guests">
            <span className="gw-tag-group__label">
              <UserPlus size={14} aria-hidden /> {t("appt.guests")}
            </span>
            {guests.map((g, i) => (
              <div key={i} className="gw-guest-row">
                <input placeholder={t("appt.guestName")} value={g.name} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} disabled={cancelled} />
                <input type="email" placeholder={t("form.email")} value={g.email} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} disabled={cancelled} />
                <input type="tel" placeholder={t("form.phone")} value={g.phone} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} disabled={cancelled} />
                <button type="button" className="pf-btn pf-btn--sm" aria-label={t("appt.removeGuest")} onClick={() => setGuests(guests.filter((_, j) => j !== i))} disabled={cancelled}>
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
            {!cancelled ? (
              <button type="button" className="pf-btn pf-btn--sm" onClick={() => setGuests([...guests, { name: "", email: "", phone: "" }])}>
                <Plus size={13} aria-hidden /> {t("appt.addGuest")}
              </button>
            ) : null}
          </div>
          {hasRecord ? (
            <label className="gw-switch">
              <input type="checkbox" checked={notifyHome} onChange={(e) => setNotifyHome(e.target.checked)} disabled={cancelled} />
              <span className="gw-switch__track" aria-hidden />
              <span>{t("appt.notifyHomeowner")}</span>
            </label>
          ) : null}
          <p className="pf-hint">{t("appt.notifyHint")}</p>
        </section>

        <section className="gw-drawer-section">
          <h3 className="gw-drawer-section__title">{t("appt.details")}</h3>
          <label className="pf-field">
            <span>{t("appt.description")}</span>
            <textarea rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} disabled={cancelled} />
          </label>
          <label className="pf-field">
            <span>{t("appt.internalNotes")}</span>
            <textarea rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={cancelled} />
          </label>
        </section>
      </div>
      <LenderEditor
        draft={newLender}
        onClose={() => setNewLender(null)}
        onSaved={(list) => {
          // Tag the lender that was just created.
          const created = list.filter((l) => !lenders.some((x) => x.id === l.id));
          if (created[0]) setLenderIds((ids) => [...ids, created[0].id]);
        }}
      />
    </SideDrawer>
  );
}

/** Tappable people chips for tagging. */
function TagGroup(props: {
  icon: typeof Users;
  label: string;
  items: Array<{ id: number; label: string }>;
  selected: number[];
  onToggle: (id: number) => void;
  empty?: string;
  disabled?: boolean;
}) {
  // Search picker (chips + type-to-find) instead of one chip per person.
  return <MultiSearchPicker {...props} />;
}
