import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Check, Copy, ExternalLink, Plus, UserCheck } from "lucide-react";
import type { BookingTeam } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createBookingTeam, fetchBookingTeams, saveBookingTeam } from "@/store/slices/schedulerSlice";
import { fetchAdminAssignees } from "@/store/slices/adminPortalSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { KitSkeleton } from "@/components/partnerKit/PartnerKit";
import BookingRulesFields from "@/components/booking/BookingRulesFields";
import { cn } from "@/lib/cn";

/**
 * Settings → Company booking page: one public link (Groundwork as the host) shared by several staff.
 * A time is open when any member is free on their own hours (Profile → My booking link), days off and
 * calendar. Every member is alerted by email, bell and text; the first to take it owns the call.
 */
export default function TeamBookingPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { teams, teamsSaving, teamsError } = useAppSelector((s) => s.scheduler);
  const staff = useAppSelector((s) => s.adminPortal.assignees.items);
  const [form, setForm] = useState<BookingTeam | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void dispatch(fetchBookingTeams());
    if (!staff.length) void dispatch(fetchAdminAssignees());
  }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps
  const team = teams?.[0] ?? null;
  useEffect(() => {
    setForm(team);
  }, [team]);

  if (teams === null) return <section className={className}><KitSkeleton layout="list" rows={2} /></section>;

  const head = (
    <div className="pf-section-head">
      <h2 className="pf-h2">
        <Building2 size={17} aria-hidden /> {t("booking.teamTitle")}
      </h2>
      {form ? (
        <label className="gw-switch">
          <input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} />
          <span className="gw-switch__track" aria-hidden />
          <span>{form.is_enabled ? t("booking.on") : t("booking.off")}</span>
        </label>
      ) : null}
    </div>
  );

  if (!form) {
    return (
      <section className={cn("gw-booking-admin", className)} id="company-booking">
        {head}
        <p className="pf-hint">{t("booking.teamLead")}</p>
        <ErrorNote error={teamsError} />
        <button type="button" className="pf-btn pf-btn--gold" disabled={teamsSaving} onClick={() => void dispatch(createBookingTeam({ name: "Groundwork Capital" }))}>
          <Plus size={14} aria-hidden /> {t("booking.teamCreate")}
        </button>
      </section>
    );
  }

  const set = (patch: Partial<BookingTeam>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const toggleMember = (id: number) => {
    const on = form.member_ids.includes(id);
    const member_ids = on ? form.member_ids.filter((x) => x !== id) : [...form.member_ids, id];
    set({ member_ids, default_admin_id: on && form.default_admin_id === id ? null : form.default_admin_id });
  };
  const nameOf = (id: number) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.first_name} ${s.last_name}`.trim() : `#${id}`;
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(form.booking_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the link is visible to copy by hand */
    }
  };
  const save = async () => {
    const r = await dispatch(saveBookingTeam({ id: form.id, body: form }));
    if (saveBookingTeam.fulfilled.match(r)) setSaved(true);
  };

  return (
    <section className={cn("gw-booking-admin", className)} id="company-booking">
      {head}
      <p className="pf-hint">{t("booking.teamLead")}</p>
      <div className="gw-booking-link">
        <code>{form.booking_url}</code>
        <button type="button" className="pf-btn pf-btn--sm" onClick={() => void copy()}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? t("booking.copied") : t("booking.copy")}
        </button>
        {team?.is_enabled ? (
          <a className="pf-btn pf-btn--sm" href={form.booking_url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> {t("booking.preview")}
          </a>
        ) : null}
      </div>
      <ErrorNote error={teamsError} />

      <div className="pf-form">
        <label className="pf-field">
          <span>{t("booking.teamName")}</span>
          <input value={form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} />
        </label>

        <fieldset className="gw-team-members">
          <legend>{t("booking.teamMembers")}</legend>
          <p className="pf-hint">{t("booking.teamMembersHint")}</p>
          <div className="gw-team-members__list">
            {staff.map((s) => {
              const on = form.member_ids.includes(s.id);
              return (
                <button key={s.id} type="button" className={cn("gw-chip", on && "gw-chip--on")} aria-pressed={on} onClick={() => toggleMember(s.id)}>
                  {on ? <UserCheck size={14} aria-hidden /> : null}
                  {`${s.first_name} ${s.last_name}`.trim()}
                </button>
              );
            })}
          </div>
          {!form.member_ids.length ? <p className="pf-muted">{t("booking.teamNoMembers")}</p> : null}
        </fieldset>

        {form.member_ids.length ? (
          <label className="pf-field">
            <span>{t("booking.teamDefault")}</span>
            <select value={form.default_admin_id ?? ""} onChange={(e) => set({ default_admin_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t("booking.teamDefaultFirstFree")}</option>
              {form.member_ids.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                </option>
              ))}
            </select>
            <small className="pf-hint">{t("booking.teamDefaultHint")}</small>
          </label>
        ) : null}

        <BookingRulesFields form={form} set={set} bookingUrl={form.booking_url} />
        <p className="pf-hint">{t("booking.teamHoursHint", { tz: form.timezone.replace("_", " ") })}</p>

        <div className="pf-actions">
          <BusyButton tone="gold" label={t("pf.save")} busy={teamsSaving} onClick={() => void save()} />
          {saved ? <span className="pf-success-inline">{t("pf.saved")}</span> : null}
        </div>
      </div>
    </section>
  );
}
