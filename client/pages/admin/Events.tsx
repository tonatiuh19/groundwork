import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { CalendarPlus, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  createAdminEvent,
  fetchAdminEvents,
} from "@/store/slices/adminPortalSlice";
import {
  DataTable,
  ErrorNote,
  FilterSelect,
  HeaderAction,
  ListPager,
  Modal,
  PageHeader,
  SearchBox,
  StatusBadge,
  SubmitButton,
  TextField,
  enumOptions,
} from "@/components/portal/kit";
import { EVENT_STATUSES } from "@/lib/eventOptions";
import { fromDateTimeLocalValue, useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const PAGE_SIZE = 50;

export default function AdminEvents() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.events);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  // Agents (leads perm) can browse; only events-perm roles can create/edit.
  const canWrite = useAdminCan("events");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const es = i18n.language?.startsWith("es");

  useEffect(() => {
    setOffset(0);
  }, [q, status]);

  useEffect(() => {
    dispatch(clearAdminSaveError());
    void dispatch(
      fetchAdminEvents({
        q: q || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    );
  }, [dispatch, q, status, offset]);

  const schema = Yup.object({
    title_en: Yup.string().trim().required(t("validation.eventTitleEn")),
    title_es: Yup.string().trim().required(t("validation.eventTitleEs")),
    city: Yup.string().trim().required(t("validation.eventCity")),
    starts_at: Yup.string().required(t("validation.eventStartsAt")),
    slug: Yup.string()
      .trim()
      .matches(/^$|^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, t("validation.slugFormat")),
  });

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="portalNav.events"
        leadKey="admin.eventsLead"
        actions={
          canWrite ? (
            <HeaderAction
              labelKey="admin.addEvent"
              icon={CalendarPlus}
              onClick={() => {
                dispatch(clearAdminSaveError());
                setOpen(true);
              }}
            />
          ) : null
        }
      />
      <div className="pf-filters">
        <SearchBox onSearch={setQ} />
        <FilterSelect
          value={status}
          onChange={setStatus}
          ariaLabel={t("pf.status")}
          allLabel={t("admin.filterAllStatuses")}
          options={enumOptions(t, "eventStatus", EVENT_STATUSES)}
        />
      </div>
      <ErrorNote error={error} />
      {!open ? <ErrorNote error={saveError} /> : null}
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noEvents"
        rowKey={(e) => e.id}
        onRowClick={(e) => navigate(`/admin/events/${e.id}`)}
        columns={[
          {
            key: "title",
            headerKey: "admin.eventTitle",
            render: (e) => (
              <>
                <strong>{es ? e.title_es || e.title_en : e.title_en}</strong>
                {e.is_featured ? (
                  <span className="pf-featured" title={t("admin.isFeatured")}>
                    <Star size={13} aria-label={t("admin.isFeatured")} />
                  </span>
                ) : null}
                <br />
                <span className="pf-muted">/events/{e.slug}</span>
              </>
            ),
          },
          { key: "date", headerKey: "event.date", render: (e) => fmt.eventDateTime(e.starts_at) },
          { key: "city", headerKey: "pf.city", render: (e) => e.city },
          {
            key: "attendees",
            headerKey: "admin.attendees",
            render: (e) => (
              <>
                {t("admin.attendeeCount", {
                  confirmed: e.confirmed_count ?? 0,
                  capacity: e.capacity ?? "∞",
                })}
                {e.waitlisted_count ? (
                  <>
                    <br />
                    <span className="pf-muted">
                      {t("admin.waitlistedCount", { count: e.waitlisted_count })}
                    </span>
                  </>
                ) : null}
              </>
            ),
          },
          {
            key: "reg",
            headerKey: "admin.registrationOpen",
            render: (e) => (e.registration_open ? t("pf.yes") : t("pf.no")),
          },
          {
            key: "status",
            headerKey: "pf.status",
            render: (e) => <StatusBadge group="eventStatus" value={e.status} />,
          },
        ]}
      />
      <ListPager
        total={total}
        limit={PAGE_SIZE}
        offset={offset}
        loading={loading}
        onPageChange={setOffset}
      />

      <Modal open={open} titleKey="admin.addEvent" onClose={() => setOpen(false)}>
        <Formik
          initialValues={{
            title_en: "",
            title_es: "",
            slug: "",
            city: "",
            starts_at: "",
          }}
          validationSchema={schema}
          onSubmit={async (v) => {
            const r = await dispatch(
              createAdminEvent({
                title_en: v.title_en.trim(),
                title_es: v.title_es.trim(),
                slug: v.slug.trim() || undefined,
                city: v.city.trim(),
                starts_at: fromDateTimeLocalValue(v.starts_at),
                status: "draft",
              }),
            );
            if (createAdminEvent.fulfilled.match(r)) {
              setOpen(false);
              const id = r.payload?.event?.id;
              if (id) navigate(`/admin/events/${id}`);
              else
                void dispatch(
                  fetchAdminEvents({ q: q || undefined, status: status || undefined, limit: PAGE_SIZE, offset }),
                );
            }
          }}
        >
          <Form className="pf-form">
            <ErrorNote error={saveError} />
            <p className="pf-muted">{t("admin.addEventHelp")}</p>
            <div className="pf-form-grid">
              <TextField name="title_en" labelKey="admin.titleEn" />
              <TextField name="title_es" labelKey="admin.titleEs" />
              <TextField name="city" labelKey="pf.city" />
              <TextField name="starts_at" labelKey="admin.startsAt" type="datetime-local" />
            </div>
            <TextField name="slug" labelKey="admin.eventSlug" placeholder="fontana-oct-2026" />
            <p className="pf-muted">{t("admin.eventSlugHelp")}</p>
            <SubmitButton busy={saving} labelKey="pf.create" />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
