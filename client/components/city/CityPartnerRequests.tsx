import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarPlus, CalendarX2, Check, MapPinPlus, Users, Video, X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  approveCityRequest,
  bookCityMeeting,
  cancelCityMeeting,
  clearCityError,
  declineCityRequest,
  fetchCityMeetings,
  fetchCityRequests,
  fetchCityStaff,
  fetchMyCityRequests,
  requestCity,
} from "@/store/slices/cityPartnerSlice";
import { fetchAdminCities } from "@/store/slices/citiesSlice";
import { BusyButton, ErrorNote, Modal, SegmentedTabs } from "@/components/portal/kit";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import { KitEmpty, KitSkeleton } from "@/components/partnerKit/PartnerKit";
import CityCreateModal from "@/components/admin/CityCreateModal";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

const statusTone = { pending: "gold", approved: "green", declined: "muted" } as const;

/** Partner portal: ask Groundwork for a city that isn't on my list, and see what happened to my requests. */
export function CityRequestPanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { myRequests, saving, error } = useAppSelector((s) => s.cityPartner);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ city_name: "", county: "", note: "" });
  const [sent, setSent] = useState(false);
  useEffect(() => {
    void dispatch(fetchMyCityRequests());
  }, [dispatch]);
  const close = () => {
    setOpen(false);
    setF({ city_name: "", county: "", note: "" });
    dispatch(clearCityError());
  };
  return (
    <section className="pf-card gw-city-requests">
      <div className="gw-city-requests__head">
        <div>
          <h2 className="pk-card-title"><MapPinPlus size={18} aria-hidden /> {t("cityPartner.request.title")}</h2>
          <p className="pf-hint">{t("cityPartner.request.lead")}</p>
        </div>
        <BusyButton tone="gold" icon={MapPinPlus} label={t("cityPartner.request.open")} busy={false} onClick={() => { setSent(false); setOpen(true); }} />
      </div>
      {sent ? <p className="pf-success" role="status">{t("cityPartner.request.sent")}</p> : null}
      {myRequests.length ? (
        <ul className="gw-city-requests__list">
          {myRequests.map((r) => (
            <li key={r.id}>
              <strong>{r.city_name}</strong>
              <span className={cn("gw-pill", `gw-pill--${statusTone[r.status]}`)}>{t(`cityPartner.request.status_${r.status}`)}</span>
              <span className="pf-hint">{fmt.date(r.decided_at || r.created_at)}</span>
              {r.status === "declined" && r.decline_reason ? <span className="pf-hint gw-city-requests__reason">{r.decline_reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <Modal open={open} titleKey="cityPartner.request.title" onClose={close}>
        <form
          className="pf-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await dispatch(requestCity({ city_name: f.city_name.trim(), county: f.county.trim() || undefined, note: f.note.trim() || undefined }));
            if (requestCity.fulfilled.match(r)) {
              close();
              setSent(true);
            }
          }}
        >
          <ErrorNote error={error} />
          <div className="pf-form-grid">
            <label className="pf-field">
              <span>{t("cityPartner.request.cityName")} *</span>
              <input value={f.city_name} maxLength={100} required onChange={(e) => setF({ ...f, city_name: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("cityPartner.request.county")}</span>
              <input value={f.county} maxLength={100} onChange={(e) => setF({ ...f, county: e.target.value })} />
            </label>
          </div>
          <label className="pf-field">
            <span>{t("cityPartner.request.note")}</span>
            <textarea rows={3} value={f.note} maxLength={500} placeholder={t("cityPartner.request.notePlaceholder")} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </label>
          <div className="pf-actions">
            <BusyButton type="submit" tone="gold" icon={MapPinPlus} label={t("cityPartner.request.send")} busy={saving} disabled={f.city_name.trim().length < 2} />
          </div>
        </form>
      </Modal>
    </section>
  );
}

const LENGTHS = [30, 45, 60, 90, 120];
const WHERE = ["office", "onsite", "phone", "video"] as const;
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

/** Partner portal, city page: book a meeting and invite Groundwork staff (lands on their calendar). */
export function CityMeetingsPanel({ cityId, cityName }: { cityId: number; cityName: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { meetings, staff, suggestedStaffId, saving, loading, error } = useAppSelector((s) => s.cityPartner);
  const [open, setOpen] = useState(false);
  const blank = () => ({ title: "", date: todayIso(), start: "10:00", duration_minutes: 60, location_type: "office" as (typeof WHERE)[number], location: "", video_url: "", description: "", admin_ids: suggestedStaffId ? [suggestedStaffId] : ([] as number[]) });
  const [f, setF] = useState(blank);
  const [booked, setBooked] = useState(false);
  useEffect(() => {
    void dispatch(fetchCityMeetings(cityId));
    void dispatch(fetchCityStaff());
  }, [dispatch, cityId]);
  const mine = meetings.filter((m) => m.city_id === cityId);
  const ready = f.admin_ids.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && /^\d{2}:\d{2}$/.test(f.start);
  return (
    <section className="gw-city-meetings">
      <div className="gw-city-requests__head">
        <p className="pf-hint">{t("cityPartner.meeting.lead")}</p>
        <BusyButton tone="gold" icon={CalendarPlus} label={t("cityPartner.meeting.open")} busy={false} onClick={() => { setBooked(false); setF(blank()); setOpen(true); }} />
      </div>
      {booked ? <p className="pf-success" role="status">{t("cityPartner.meeting.booked")}</p> : null}
      {loading && !mine.length ? <KitSkeleton layout="list" rows={2} /> : mine.length ? (
        <ul className="gw-city-meetings__list">
          {mine.map((m) => (
            <li key={m.id} className="pf-card">
              <div className="gw-city-meetings__when">{fmt.eventDateTime(m.starts_at)}</div>
              <strong>{m.title}</strong>
              <span className="pf-hint"><Users size={14} aria-hidden /> {m.staff.join(", ")}</span>
              {m.location ? <span className="pf-hint">{m.location}</span> : null}
              <BusyButton
                icon={CalendarX2}
                label={t("cityPartner.meeting.cancel")}
                busy={saving}
                onClick={() => {
                  if (window.confirm(t("cityPartner.meeting.cancelConfirm"))) void dispatch(cancelCityMeeting(m.id));
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <KitEmpty icon={CalendarPlus} title={t("cityPartner.meeting.none")} text={t("cityPartner.meeting.noneText")} />
      )}
      <Modal open={open} titleKey="cityPartner.meeting.title" onClose={() => { setOpen(false); dispatch(clearCityError()); }}>
        <form
          className="pf-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await dispatch(
              bookCityMeeting({
                city_id: cityId,
                title: f.title.trim() || undefined,
                date: f.date,
                start: f.start,
                duration_minutes: f.duration_minutes,
                timezone: "America/Los_Angeles",
                location_type: f.location_type,
                location: f.location_type === "video" ? undefined : f.location.trim() || undefined,
                video_url: f.location_type === "video" ? f.video_url.trim() || undefined : undefined,
                description: f.description.trim() || undefined,
                admin_ids: f.admin_ids,
              }),
            );
            if (bookCityMeeting.fulfilled.match(r)) {
              setOpen(false);
              setBooked(true);
            }
          }}
        >
          <ErrorNote error={error} />
          <label className="pf-field">
            <span>{t("cityPartner.meeting.what")}</span>
            <input value={f.title} maxLength={200} placeholder={t("cityPartner.meeting.whatPlaceholder", { city: cityName })} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </label>
          <div className="pf-form-grid gw-city-meetings__time">
            <label className="pf-field">
              <span>{t("cityPartner.meeting.date")}</span>
              <input type="date" value={f.date} min={todayIso()} required onChange={(e) => setF({ ...f, date: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("cityPartner.meeting.start")}</span>
              <input type="time" value={f.start} required onChange={(e) => setF({ ...f, start: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("cityPartner.meeting.length")}</span>
              <select value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })}>
                {LENGTHS.map((m) => (
                  <option key={m} value={m}>{t("cityPartner.meeting.minutes", { count: m })}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="pf-hint">{t("cityPartner.meeting.tz")}</p>
          <fieldset className="gw-city-meetings__where">
            <legend>{t("cityPartner.meeting.where")}</legend>
            {WHERE.map((w) => (
              <button key={w} type="button" className={cn("gw-chip", f.location_type === w && "gw-chip--on")} aria-pressed={f.location_type === w} onClick={() => setF({ ...f, location_type: w })}>
                {w === "video" ? <Video size={14} aria-hidden /> : null} {t(`cityPartner.meeting.where_${w}`)}
              </button>
            ))}
          </fieldset>
          {f.location_type === "video" ? (
            <label className="pf-field">
              <span>{t("cityPartner.meeting.videoLink")}</span>
              <input type="url" value={f.video_url} maxLength={500} placeholder="https://" onChange={(e) => setF({ ...f, video_url: e.target.value })} />
            </label>
          ) : (
            <label className="pf-field">
              <span>{t("cityPartner.meeting.address")}</span>
              <input value={f.location} maxLength={500} placeholder={t("cityPartner.meeting.addressPlaceholder", { city: cityName })} onChange={(e) => setF({ ...f, location: e.target.value })} />
            </label>
          )}
          <MultiSearchPicker
            icon={Users}
            label={`${t("cityPartner.meeting.invite")} *`}
            items={staff.map((s) => ({ id: s.id, label: s.name }))}
            selected={f.admin_ids}
            placeholder={t("cityPartner.meeting.inviteSearch")}
            onToggle={(id) => setF({ ...f, admin_ids: f.admin_ids.includes(id) ? f.admin_ids.filter((x) => x !== id) : [...f.admin_ids, id].slice(0, 5) })}
          />
          <p className="pf-hint">{t("cityPartner.meeting.inviteHint")}</p>
          <label className="pf-field">
            <span>{t("cityPartner.meeting.notes")}</span>
            <textarea rows={3} value={f.description} maxLength={4000} placeholder={t("cityPartner.meeting.notesPlaceholder")} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </label>
          <div className="pf-actions">
            <BusyButton type="submit" tone="gold" icon={CalendarPlus} label={t("cityPartner.meeting.send")} busy={saving} disabled={!ready} />
          </div>
        </form>
      </Modal>
    </section>
  );
}

/** Admin → City Partners → City requests: approve (pick or add the city, then it's assigned) or decline with a reason. */
export function CityRequestsAdmin() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { requests, saving, loading, error } = useAppSelector((s) => s.cityPartner);
  const cities = useAppSelector((s) => s.cities.adminList);
  const [status, setStatus] = useState<"pending" | "approved" | "declined">("pending");
  const [approving, setApproving] = useState<number | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [declining, setDeclining] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const load = () => void dispatch(fetchCityRequests({ status }));
  useEffect(load, [dispatch, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void dispatch(fetchAdminCities());
  }, [dispatch]);
  const current = requests.find((r) => r.id === approving);
  return (
    <section className="gw-city-requests-admin">
      <SegmentedTabs<"pending" | "approved" | "declined">
        value={status}
        onChange={setStatus}
        ariaLabel={t("cityPartner.request.adminTitle")}
        options={[
          { value: "pending", labelKey: "cityPartner.request.status_pending" },
          { value: "approved", labelKey: "cityPartner.request.status_approved" },
          { value: "declined", labelKey: "cityPartner.request.status_declined" },
        ]}
      />
      <ErrorNote error={error} />
      {loading && !requests.length ? <KitSkeleton layout="list" rows={3} /> : requests.length ? (
        <ul className="gw-city-requests__list gw-city-requests__list--admin">
          {requests.map((r) => (
            <li key={r.id} className="pf-card">
              <div>
                <strong>{r.city_name}</strong>
                {r.county ? <span className="pf-hint"> · {r.county}</span> : null}
                <p className="pf-hint">{r.partner?.company || r.partner?.name} · {fmt.date(r.created_at)}</p>
                {r.note ? <p>{r.note}</p> : null}
                {r.decline_reason ? <p className="pf-hint">{r.decline_reason}</p> : null}
              </div>
              {r.status === "pending" ? (
                <div className="pf-actions">
                  <BusyButton
                    tone="gold"
                    icon={Check}
                    label={t("cityPartner.request.approve")}
                    busy={false}
                    onClick={() => {
                      const match = cities.find((c) => !c.archived && c.name.toLowerCase() === r.city_name.toLowerCase());
                      setCityId(match ? match.id : null);
                      setApproving(r.id);
                    }}
                  />
                  <BusyButton icon={X} label={t("cityPartner.request.decline")} busy={false} onClick={() => { setReason(""); setDeclining(r.id); }} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <KitEmpty icon={MapPinPlus} title={t("cityPartner.request.noneAdmin")} />
      )}
      <Modal open={approving !== null} titleKey="cityPartner.request.approveTitle" onClose={() => setApproving(null)}>
        <div className="pf-form">
          <p>{t("cityPartner.request.approveLead", { city: current?.city_name || "", partner: current?.partner?.company || current?.partner?.name || "" })}</p>
          <MultiSearchPicker
            icon={MapPinPlus}
            label={t("cities.filter")}
            items={cities.filter((c) => !c.archived).map((c) => ({ id: c.id, label: c.name }))}
            selected={cityId ? [cityId] : []}
            placeholder={t("cities.search")}
            onToggle={(id) => setCityId(cityId === id ? null : id)}
            onCreate={(q) => setQuickAdd(q || current?.city_name || "")}
            createLabel={(q) => (q ? t("cities.addNamed", { name: q }) : t("cities.addNamed", { name: current?.city_name || "" }))}
          />
          <CityCreateModal
            initialName={quickAdd}
            onClose={() => setQuickAdd(null)}
            onPicked={(id) => {
              void dispatch(fetchAdminCities());
              setCityId(id);
            }}
          />
          <div className="pf-actions">
            <BusyButton
              tone="gold"
              icon={Check}
              label={t("cityPartner.request.approveConfirm")}
              busy={saving}
              disabled={!cityId}
              onClick={async () => {
                const r = await dispatch(approveCityRequest({ id: approving!, city_id: cityId! }));
                if (approveCityRequest.fulfilled.match(r)) {
                  setApproving(null);
                  load();
                }
              }}
            />
          </div>
        </div>
      </Modal>
      <Modal open={declining !== null} titleKey="cityPartner.request.declineTitle" onClose={() => setDeclining(null)}>
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("cityPartner.request.reason")} *</span>
            <textarea rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="pf-hint">{t("cityPartner.request.reasonHint")}</p>
          <div className="pf-actions">
            <BusyButton
              icon={X}
              label={t("cityPartner.request.declineConfirm")}
              busy={saving}
              disabled={reason.trim().length < 3}
              onClick={async () => {
                const r = await dispatch(declineCityRequest({ id: declining!, reason: reason.trim() }));
                if (declineCityRequest.fulfilled.match(r)) {
                  setDeclining(null);
                  load();
                }
              }}
            />
          </div>
        </div>
      </Modal>
    </section>
  );
}
