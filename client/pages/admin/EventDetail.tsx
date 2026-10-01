import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Archive, Download, ExternalLink, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MarketingEvent } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminEvent,
  clearAdminSaveError,
  deleteAdminEvent,
  fetchAdminEventAttendees,
  fetchAdminEventDetail,
  updateAdminEvent,
  type AdminEventAttendee,
} from "@/store/slices/adminPortalSlice";
import {
  BackLink,
  BusyButton,
  CheckField,
  DataTable,
  ErrorNote,
  FilterSelect,
  ListPager,
  Loading,
  Modal,
  PageHeader,
  RecordHeadCard,
  SearchBox,
  SelectField,
  StatCard,
  StatusBadge,
  SubmitButton,
  TextField,
  enumOptions,
  useBusyAction,
} from "@/components/portal/kit";
import { downloadCsv, toCsv } from "@/lib/csv";
import { EVENT_STATUSES, REGISTRATION_STATUSES } from "@/lib/eventOptions";
import {
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  useFormatters,
} from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const ATTENDEE_PAGE = 50;
// API caps list pages at 100 rows.
const EXPORT_PAGE = 100;

const optionalUrl = (t: (k: string) => string) =>
  Yup.string()
    .trim()
    .matches(/^$|^https?:\/\/\S+$/i, t("validation.photoUrl"));

const textOrNull = (v: string) => v.trim() || null;

const toValues = (e: MarketingEvent) => ({
  status: e.status as string,
  slug: e.slug,
  is_featured: Boolean(e.is_featured),
  city: e.city || "",
  starts_at: toDateTimeLocalValue(e.starts_at),
  ends_at: toDateTimeLocalValue(e.ends_at),
  registration_opens_at: toDateTimeLocalValue(e.registration_opens_at),
  registration_closes_at: toDateTimeLocalValue(e.registration_closes_at),
  capacity: e.capacity == null ? "" : String(e.capacity),
  waitlist_enabled: Boolean(e.waitlist_enabled),
  venue_name: e.venue_name || "",
  venue_address: e.venue_address || "",
  zoom_url: e.zoom_url || "",
  image_url: e.image_url || "",
  title_en: e.title_en || "",
  title_es: e.title_es || "",
  summary_en: e.summary_en || "",
  summary_es: e.summary_es || "",
  location_label_en: e.location_label_en || "",
  location_label_es: e.location_label_es || "",
  cta_en: e.cta_en || "",
  cta_es: e.cta_es || "",
  body_en: e.body_en || "",
  body_es: e.body_es || "",
});

export default function AdminEventDetail() {
  const { t, i18n } = useTranslation();
  const { id: rawId = "" } = useParams();
  const id = Number(rawId);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.eventDetail);
  const attendees = useAppSelector((s) => s.adminPortal.eventAttendees);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const canWrite = useAdminCan("events");
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [regStatus, setRegStatus] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const archiveBusy = useBusyAction(900);
  const deleteBusy = useBusyAction(900);

  const validId = Number.isInteger(id) && id > 0;
  const ev = data?.id === id ? data : null;
  const es = i18n.language?.startsWith("es");

  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminEvent());
    setSaved(false);
    setOffset(0);
    if (validId) void dispatch(fetchAdminEventDetail(id));
    return () => {
      dispatch(clearAdminEvent());
    };
  }, [dispatch, id, validId]);

  useEffect(() => {
    setOffset(0);
  }, [regStatus, q]);

  const loadAttendees = useCallback(
    () =>
      validId
        ? dispatch(
            fetchAdminEventAttendees({
              id,
              q: q || undefined,
              registration_status: regStatus || undefined,
              limit: ATTENDEE_PAGE,
              offset,
            }),
          )
        : undefined,
    [dispatch, id, validId, q, regStatus, offset],
  );
  useEffect(() => {
    void loadAttendees();
  }, [loadAttendees]);

  const exportCsv = async () => {
    if (!ev) return;
    setExporting(true);
    try {
      // Page through every attendee that matches the current filters.
      const rows: AdminEventAttendee[] = [];
      let total = Infinity;
      while (rows.length < total) {
        const r = await dispatch(
          fetchAdminEventAttendees({
            id: ev.id,
            q: q || undefined,
            registration_status: regStatus || undefined,
            limit: EXPORT_PAGE,
            offset: rows.length,
          }),
        );
        if (!fetchAdminEventAttendees.fulfilled.match(r)) return;
        total = r.payload.total;
        if (!r.payload.items.length) break;
        rows.push(...r.payload.items);
      }
      const csv = toCsv<AdminEventAttendee>(rows, [
        { header: t("pf.name"), value: (a) => a.full_name },
        { header: t("form.email"), value: (a) => a.email },
        { header: t("pf.phone"), value: (a) => a.phone },
        { header: t("pf.address"), value: (a) => a.property_address },
        {
          header: t("pf.status"),
          value: (a) =>
            a.event_registration_status ? t(`registrationStatus.${a.event_registration_status}`) : "",
        },
        { header: t("pf.created"), value: (a) => a.created_at },
      ]);
      downloadCsv(`${ev.slug}-attendees.csv`, csv);
    } finally {
      setExporting(false);
      void loadAttendees();
    }
  };

  const schema = Yup.object({
    status: Yup.string().oneOf([...EVENT_STATUSES]).required(),
    slug: Yup.string()
      .trim()
      .matches(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, t("validation.slugFormat"))
      .required(t("validation.slugFormat")),
    city: Yup.string().trim().required(t("validation.eventCity")),
    starts_at: Yup.string().required(t("validation.eventStartsAt")),
    ends_at: Yup.string().test("after-start", t("validation.eventEndsBeforeStart"), function (v) {
      const start = this.parent.starts_at as string;
      return !v || !start || v >= start;
    }),
    registration_closes_at: Yup.string().test(
      "after-open",
      t("validation.eventCloseBeforeOpen"),
      function (v) {
        const open = this.parent.registration_opens_at as string;
        return !v || !open || v >= open;
      },
    ),
    capacity: Yup.string()
      .trim()
      .matches(/^\d*$/, t("validation.eventCapacity"))
      .test("positive", t("validation.eventCapacity"), (v) => !v || Number(v) >= 1),
    title_en: Yup.string().trim().required(t("validation.eventTitleEn")),
    title_es: Yup.string().trim().required(t("validation.eventTitleEs")),
    zoom_url: optionalUrl(t),
    image_url: optionalUrl(t),
  });

  // The API refuses to delete published events or events with RSVPs (archive instead).
  const deletable =
    ev !== null &&
    ev.status !== "published" &&
    (ev.confirmed_count ?? 0) + (ev.waitlisted_count ?? 0) === 0;

  const title = ev ? (es ? ev.title_es || ev.title_en : ev.title_en) : undefined;

  return (
    <div className="portal-page">
      <PageHeader titleKey="admin.eventTitle" title={title} leadKey="admin.eventDetailLead" />
      <BackLink to="/admin/events" labelKey="admin.backToEvents" />
      <ErrorNote error={error} />
      {loading && !ev ? <Loading /> : null}
      {ev ? (
        <>
          <RecordHeadCard
            kicker={t("portalNav.events")}
            title={title || ev.slug}
            subtitle={`/events/${ev.slug} · ${fmt.eventDateTime(ev.starts_at)}`}
            statusGroup="eventStatus"
            status={ev.status}
            actions={
              <>
                {ev.status === "published" ? (
                  <a
                    className="pf-btn"
                    href={`/events/${ev.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} /> {t("admin.viewPublicPage")}
                  </a>
                ) : null}
                {canWrite && deletable ? (
                  <button
                    type="button"
                    className="pf-btn pf-btn--danger"
                    onClick={() => {
                      dispatch(clearAdminSaveError());
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 size={14} /> {t("admin.deleteEvent")}
                  </button>
                ) : null}
                {canWrite && !deletable && ev.status !== "archived" ? (
                  <BusyButton
                    icon={Archive}
                    label={t("admin.archiveEvent")}
                    busyLabel={t("pf.busy.archiving")}
                    doneLabel={t("pf.done.archived")}
                    busy={archiveBusy.busy}
                    done={archiveBusy.done}
                    title={t("admin.archiveEventHelp")}
                    onClick={() => {
                      void archiveBusy.run(
                        async () => {
                          const r = await dispatch(
                            updateAdminEvent({ id: ev.id, patch: { status: "archived" } }),
                          );
                          return updateAdminEvent.fulfilled.match(r);
                        },
                        {
                          flash: true,
                          onFlashEnd: () => {
                            void dispatch(fetchAdminEventDetail(ev.id));
                          },
                        },
                      );
                    }}
                  />
                ) : null}
              </>
            }
          />

          <div className="pf-stats">
            <StatCard
              labelKey="admin.confirmed"
              value={ev.capacity != null ? `${ev.confirmed_count ?? 0} / ${ev.capacity}` : (ev.confirmed_count ?? 0)}
            />
            <StatCard labelKey="admin.waitlisted" value={ev.waitlisted_count ?? 0} />
            <StatCard
              labelKey="admin.spotsRemaining"
              value={
                ev.capacity != null
                  ? Math.max(0, ev.capacity - (ev.confirmed_count ?? 0))
                  : t("admin.unlimited")
              }
            />
            <StatCard
              labelKey="admin.registrationOpen"
              value={ev.registration_open ? t("pf.yes") : t("pf.no")}
              tone={ev.registration_open ? "gold" : undefined}
            />
          </div>

          <ErrorNote error={confirmDelete ? null : saveError} />
          {saved ? (
            <p className="pf-muted" role="status">
              {t("pf.saved")}
            </p>
          ) : null}

          <section className="pf-section">
            <h2 className="pf-h2">{t("admin.recordDetails")}</h2>
            <Formik
              enableReinitialize
              initialValues={toValues(ev)}
              validationSchema={schema}
              onSubmit={async (v) => {
                setSaved(false);
                const r = await dispatch(
                  updateAdminEvent({
                    id: ev.id,
                    patch: {
                      status: v.status,
                      slug: v.slug.trim(),
                      is_featured: v.is_featured,
                      city: v.city.trim(),
                      starts_at: fromDateTimeLocalValue(v.starts_at),
                      ends_at: fromDateTimeLocalValue(v.ends_at),
                      registration_opens_at: fromDateTimeLocalValue(v.registration_opens_at),
                      registration_closes_at: fromDateTimeLocalValue(v.registration_closes_at),
                      capacity: v.capacity.trim() === "" ? null : Number(v.capacity),
                      waitlist_enabled: v.waitlist_enabled,
                      venue_name: textOrNull(v.venue_name),
                      venue_address: textOrNull(v.venue_address),
                      zoom_url: textOrNull(v.zoom_url),
                      image_url: textOrNull(v.image_url),
                      title_en: v.title_en.trim(),
                      title_es: v.title_es.trim(),
                      summary_en: textOrNull(v.summary_en),
                      summary_es: textOrNull(v.summary_es),
                      location_label_en: textOrNull(v.location_label_en),
                      location_label_es: textOrNull(v.location_label_es),
                      cta_en: textOrNull(v.cta_en),
                      cta_es: textOrNull(v.cta_es),
                      body_en: textOrNull(v.body_en),
                      body_es: textOrNull(v.body_es),
                    },
                  }),
                );
                if (updateAdminEvent.fulfilled.match(r)) {
                  setSaved(true);
                  void dispatch(fetchAdminEventDetail(ev.id));
                }
              }}
            >
              <Form className="pf-form pf-card">
                <h3 className="pf-h3">{t("admin.eventSectionBasics")}</h3>
                <div className="pf-form-grid">
                  <SelectField
                    name="status"
                    labelKey="pf.status"
                    options={enumOptions(t, "eventStatus", EVENT_STATUSES)}
                    disabled={!canWrite}
                  />
                  <TextField name="slug" labelKey="admin.eventSlug" disabled={!canWrite} />
                  <TextField name="city" labelKey="pf.city" disabled={!canWrite} />
                </div>
                <CheckField name="is_featured" labelKey="admin.isFeatured" disabled={!canWrite} />
                <p className="pf-muted">{t("admin.isFeaturedHelp")}</p>

                <h3 className="pf-h3">{t("admin.eventSectionSchedule")}</h3>
                <div className="pf-form-grid">
                  <TextField name="starts_at" labelKey="admin.startsAt" type="datetime-local" disabled={!canWrite} />
                  <TextField name="ends_at" labelKey="admin.endsAt" type="datetime-local" disabled={!canWrite} />
                  <TextField
                    name="registration_opens_at"
                    labelKey="admin.registrationOpens"
                    type="datetime-local"
                    disabled={!canWrite}
                  />
                  <TextField
                    name="registration_closes_at"
                    labelKey="admin.registrationCloses"
                    type="datetime-local"
                    disabled={!canWrite}
                  />
                </div>
                <p className="pf-muted">{t("admin.eventScheduleHelp")}</p>

                <h3 className="pf-h3">{t("admin.eventSectionCapacity")}</h3>
                <div className="pf-form-grid">
                  <TextField
                    name="capacity"
                    labelKey="admin.capacity"
                    type="number"
                    placeholder={t("admin.unlimited")}
                    disabled={!canWrite}
                  />
                </div>
                <CheckField name="waitlist_enabled" labelKey="admin.waitlistEnabled" disabled={!canWrite} />
                <p className="pf-muted">{t("admin.capacityHelp")}</p>

                <h3 className="pf-h3">{t("admin.eventSectionVenue")}</h3>
                <div className="pf-form-grid">
                  <TextField name="venue_name" labelKey="admin.venueName" disabled={!canWrite} />
                  <TextField name="venue_address" labelKey="admin.venueAddress" disabled={!canWrite} />
                  <TextField name="zoom_url" labelKey="admin.zoomUrl" type="url" disabled={!canWrite} />
                  <TextField name="image_url" labelKey="admin.eventImageUrl" type="url" disabled={!canWrite} />
                </div>

                <h3 className="pf-h3">{t("admin.eventSectionEn")}</h3>
                <div className="pf-form-grid">
                  <TextField name="title_en" labelKey="admin.titleEn" disabled={!canWrite} />
                  <TextField name="location_label_en" labelKey="admin.locationLabelEn" disabled={!canWrite} />
                  <TextField name="cta_en" labelKey="admin.ctaEn" disabled={!canWrite} />
                </div>
                <TextField name="summary_en" labelKey="admin.summaryEn" as="textarea" rows={2} disabled={!canWrite} />
                <TextField name="body_en" labelKey="admin.bodyEn" as="textarea" rows={7} disabled={!canWrite} />

                <h3 className="pf-h3">{t("admin.eventSectionEs")}</h3>
                <div className="pf-form-grid">
                  <TextField name="title_es" labelKey="admin.titleEs" disabled={!canWrite} />
                  <TextField name="location_label_es" labelKey="admin.locationLabelEs" disabled={!canWrite} />
                  <TextField name="cta_es" labelKey="admin.ctaEs" disabled={!canWrite} />
                </div>
                <TextField name="summary_es" labelKey="admin.summaryEs" as="textarea" rows={2} disabled={!canWrite} />
                <TextField name="body_es" labelKey="admin.bodyEs" as="textarea" rows={7} disabled={!canWrite} />

                {canWrite ? <SubmitButton busy={saving} labelKey="pf.save" /> : null}
              </Form>
            </Formik>
          </section>

          <section className="pf-section">
            <div className="pf-section-head">
              <h2 className="pf-h2">{t("admin.attendees")}</h2>
              <BusyButton
                icon={Download}
                label={t("admin.exportCsv")}
                busyLabel={t("pf.busy.exporting")}
                busy={exporting}
                disabled={attendees.total === 0}
                onClick={() => void exportCsv()}
              />
            </div>
            <div className="pf-filters">
              <SearchBox onSearch={setQ} />
              <FilterSelect
                value={regStatus}
                onChange={setRegStatus}
                ariaLabel={t("pf.status")}
                allLabel={t("admin.filterAllRegistrations")}
                options={enumOptions(t, "registrationStatus", REGISTRATION_STATUSES)}
              />
            </div>
            <ErrorNote error={attendees.error} />
            <DataTable
              rows={attendees.items}
              loading={attendees.loading}
              emptyKey="admin.noAttendees"
              rowKey={(a) => a.id}
              columns={[
                {
                  key: "name",
                  headerKey: "pf.name",
                  render: (a) => (
                    <>
                      <strong>{a.full_name}</strong>
                      <br />
                      <span className="pf-muted">
                        {a.email} · {a.phone}
                      </span>
                    </>
                  ),
                },
                { key: "address", headerKey: "pf.address", render: (a) => a.property_address || "—" },
                { key: "date", headerKey: "admin.registeredAt", render: (a) => fmt.date(a.created_at) },
                {
                  key: "status",
                  headerKey: "pf.status",
                  render: (a) =>
                    a.event_registration_status ? (
                      <StatusBadge group="registrationStatus" value={a.event_registration_status} />
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
            <ListPager
              total={attendees.total}
              limit={ATTENDEE_PAGE}
              offset={offset}
              loading={attendees.loading}
              onPageChange={setOffset}
            />
          </section>

          <Modal open={confirmDelete} titleKey="admin.deleteEventTitle" onClose={() => setConfirmDelete(false)}>
            <div className="pf-form">
              <ErrorNote error={saveError} />
              <p className="pf-muted">{t("admin.deleteEventHelp", { name: title || ev.slug })}</p>
              <div className="pf-actions">
                <button type="button" className="pf-btn" onClick={() => setConfirmDelete(false)} disabled={deleteBusy.busy}>
                  {t("pf.cancel")}
                </button>
                <BusyButton
                  tone="gold"
                  className="pf-submit"
                  label={t("admin.deleteEvent")}
                  busyLabel={t("pf.busy.deleting")}
                  doneLabel={t("pf.done.deleted")}
                  busy={deleteBusy.busy}
                  done={deleteBusy.done}
                  onClick={() => {
                    void deleteBusy.run(
                      async () => {
                        const r = await dispatch(deleteAdminEvent(ev.id));
                        return deleteAdminEvent.fulfilled.match(r);
                      },
                      {
                        flash: true,
                        onFlashEnd: () => {
                          setConfirmDelete(false);
                          navigate("/admin/events", { replace: true });
                        },
                      },
                    );
                  }}
                />
              </div>
            </div>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
