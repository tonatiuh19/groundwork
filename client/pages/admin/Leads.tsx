import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Formik, Form } from "formik";
import { ArrowRightCircle, NotebookPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdminLead } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  convertAdminLead,
  fetchAdminEvents,
  fetchAdminLeads,
  fetchAdminPlans,
  updateAdminLead,
} from "@/store/slices/adminPortalSlice";
import {
  DataTable,
  ErrorNote,
  FilterSelect,
  InlineSelect,
  ListPager,
  Modal,
  PageHeader,
  SearchBox,
  SelectField,
  StatusBadge,
  SubmitButton,
  TextField,
  enumOptions,
  useRowBusy,
} from "@/components/portal/kit";
import { LEAD_MODES } from "@/lib/eventOptions";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const STATUSES = ["new", "contacted", "qualified", "closed", "spam"] as const;
const PAGE_SIZE = 50;

export default function AdminLeads() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.leads);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const plans = useAppSelector((s) => s.adminPortal.plans.items);
  const events = useAppSelector((s) => s.adminPortal.events.items);
  const canConvert = useAdminCan("projects.write");
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const [eventId, setEventId] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [noteLead, setNoteLead] = useState<AdminLead | null>(null);
  const [convertLead, setConvertLead] = useState<AdminLead | null>(null);
  const rowBusy = useRowBusy();

  useEffect(() => {
    setOffset(0);
  }, [status, q, mode, eventId]);

  // Event filter options (newest first); failure just leaves the picker empty.
  useEffect(() => {
    void dispatch(fetchAdminEvents({ limit: 100 }));
  }, [dispatch]);

  const load = () =>
    void dispatch(
      fetchAdminLeads({
        status: status || undefined,
        q: q || undefined,
        mode: mode || undefined,
        event_id: eventId || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    );
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, [status, q, mode, eventId, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const openConvert = (lead: AdminLead) => {
    dispatch(clearAdminSaveError());
    void dispatch(fetchAdminPlans());
    setConvertLead(lead);
  };

  const modalOpen = Boolean(noteLead || convertLead);

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.leads" leadKey="admin.leadsLead" />
      <div className="pf-filters">
        <SearchBox onSearch={setQ} />
        <FilterSelect
          value={status}
          onChange={setStatus}
          ariaLabel={t("pf.status")}
          allLabel={t("admin.filterAllStatuses")}
          options={enumOptions(t, "leadStatus", STATUSES)}
        />
        <FilterSelect
          value={mode}
          onChange={(v) => {
            setMode(v);
            if (v === "standard") setEventId("");
          }}
          ariaLabel={t("admin.leadMode")}
          allLabel={t("admin.filterAllModes")}
          options={enumOptions(t, "leadMode", LEAD_MODES)}
        />
        <FilterSelect
          value={eventId}
          onChange={(v) => {
            setEventId(v);
            if (v) setMode("event");
          }}
          ariaLabel={t("admin.leadEvent")}
          allLabel={t("admin.filterAllEvents")}
          options={events.map((e) => ({
            value: e.id,
            label: i18n.language?.startsWith("es") ? e.title_es || e.title_en : e.title_en,
          }))}
        />
      </div>
      <ErrorNote error={error} />
      {!modalOpen ? <ErrorNote error={saveError} /> : null}
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noLeads"
        rowKey={(l) => l.id}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (l) => (
              <>
                <strong>{l.full_name}</strong>
                <br />
                <span className="pf-muted">{l.email} · {l.phone}</span>
              </>
            ),
          },
          { key: "address", headerKey: "pf.address", render: (l) => l.property_address || "—" },
          { key: "source", headerKey: "admin.source", render: (l) => l.source || "—" },
          {
            key: "mode",
            headerKey: "admin.leadMode",
            render: (l) => t(`leadMode.${l.mode}`, { defaultValue: l.mode }),
          },
          {
            key: "event",
            headerKey: "admin.leadEvent",
            render: (l) =>
              l.event_id ? (
                <>
                  <Link className="text-link" to={`/admin/events/${l.event_id}`}>
                    {l.event_title || l.event_city || `#${l.event_id}`}
                  </Link>
                  {l.event_registration_status ? (
                    <>
                      <br />
                      <StatusBadge group="registrationStatus" value={l.event_registration_status} />
                    </>
                  ) : null}
                </>
              ) : (
                l.event_city || "—"
              ),
          },
          { key: "aff", headerKey: "admin.affiliate", render: (l) => l.affiliate_name || "—" },
          { key: "date", headerKey: "pf.created", render: (l) => fmt.date(l.created_at) },
          {
            key: "notes",
            headerKey: "pf.notes",
            render: (l) => (
              <button
                type="button"
                className="pf-btn pf-note-cell"
                onClick={() => {
                  dispatch(clearAdminSaveError());
                  setNoteLead(l);
                }}
              >
                <NotebookPen size={14} />{" "}
                <span className="pf-note-cell-text">{l.notes || t("admin.addNote")}</span>
              </button>
            ),
          },
          {
            key: "status",
            headerKey: "pf.status",
            render: (l) => (
              <InlineSelect
                ariaLabel={t("pf.status")}
                value={l.status}
                disabled={rowBusy.isRowLocked(l.id)}
                options={enumOptions(t, "leadStatus", STATUSES)}
                onChange={(v) => {
                  void rowBusy.run(
                    l.id,
                    "status",
                    async () => {
                      const r = await dispatch(updateAdminLead({ id: l.id, patch: { status: v } }));
                      return updateAdminLead.fulfilled.match(r);
                    },
                    { onFlashEnd: load },
                  );
                }}
              />
            ),
          },
          {
            key: "convert",
            headerKey: "pf.actions",
            render: (l) =>
              canConvert && !l.client_id ? (
                <button type="button" className="pf-btn" onClick={() => openConvert(l)}>
                  <ArrowRightCircle size={15} /> {t("admin.convert")}
                </button>
              ) : l.client_id ? (
                <span className="pf-muted">{t("admin.converted")}</span>
              ) : null,
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

      <Modal
        open={Boolean(noteLead)}
        titleKey="admin.leadNotesTitle"
        onClose={() => setNoteLead(null)}
      >
        {noteLead ? (
          <Formik
            initialValues={{ notes: noteLead.notes || "" }}
            onSubmit={async (v) => {
              const r = await dispatch(
                updateAdminLead({ id: noteLead.id, patch: { notes: v.notes.trim() || null } }),
              );
              if (updateAdminLead.fulfilled.match(r)) {
                setNoteLead(null);
                load();
              }
            }}
          >
            <Form className="pf-form">
              <ErrorNote error={saveError} />
              <p className="pf-muted">{noteLead.full_name}</p>
              <TextField name="notes" labelKey="admin.internalNotes" as="textarea" rows={5} />
              <SubmitButton busy={saving} labelKey="pf.save" />
            </Form>
          </Formik>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(convertLead)}
        titleKey="admin.convertLeadTitle"
        onClose={() => setConvertLead(null)}
      >
        {convertLead ? (
          <Formik
            initialValues={{ adu_plan_id: "" }}
            onSubmit={async (v) => {
              const r = await dispatch(
                convertAdminLead({
                  id: convertLead.id,
                  adu_plan_id: v.adu_plan_id ? Number(v.adu_plan_id) : null,
                }),
              );
              if (convertAdminLead.fulfilled.match(r)) {
                setConvertLead(null);
                navigate(`/admin/projects/${r.payload.project_public_id}`);
              }
            }}
          >
            <Form className="pf-form">
              <ErrorNote error={saveError} />
              <p className="pf-muted">
                {t("admin.convertLeadHelp", { name: convertLead.full_name })}
              </p>
              <SelectField
                name="adu_plan_id"
                labelKey="pf.plan"
                options={[
                  { value: "", label: t("aff.planUnknown") },
                  ...plans
                    .filter((p) => p.is_active)
                    .map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <SubmitButton busy={saving} labelKey="admin.convert" />
            </Form>
          </Formik>
        ) : null}
      </Modal>
    </div>
  );
}
