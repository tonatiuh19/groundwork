import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Formik, Form } from "formik";
import { ArrowRightCircle, MessageSquare, NotebookPen, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import DuplicatesPanel from "@/components/admin/DuplicatesPanel";
import type {
  AdminLead,
  LeadConvertPhoneMatch,
  LeadConvertStatus,
  LeadConvertTarget,
} from "@shared/api";
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
  SegmentedTabs,
  SelectField,
  StatusBadge,
  SubmitButton,
  TextField,
  enumOptions,
  useRowBusy,
} from "@/components/portal/kit";
import { LEAD_MODES } from "@/lib/eventOptions";
import { useFormatters } from "@/lib/format";
import PersonConflictNotice from "@/components/portal/PersonConflictNotice";
import { useAdminCan } from "@/hooks/useAdminCan";
import LeadTouchCell from "@/components/admin/leads/LeadTouchCell";
import LeadQuickText from "@/components/admin/leads/LeadQuickText";
import { conversationsDialUrl } from "@/lib/conversationDeepLink";
import type { LeadListView } from "@shared/api";
import {
  leadAlreadyConverted,
  smartLeadConvertTarget,
} from "@/lib/leadConvertTarget";

const STATUSES = ["new", "contacted", "qualified", "closed", "spam"] as const;
const PAGE_SIZE = 50;

function pickDefaultTarget(
  lead: AdminLead,
  canClient: boolean,
  canApprovals: boolean,
): LeadConvertTarget {
  const smart = smartLeadConvertTarget(lead);
  if (smart === "client" && canClient) return "client";
  if (smart === "affiliate" && canApprovals) return "affiliate";
  if (smart === "contractor" && canApprovals) return "contractor";
  if (canClient) return "client";
  if (canApprovals) return "affiliate";
  return "client";
}

export default function AdminLeads() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.leads);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const plans = useAppSelector((s) => s.adminPortal.plans.items);
  const events = useAppSelector((s) => s.adminPortal.events.items);
  const canClientConvert = useAdminCan("projects.write");
  const canApprovalsConvert = useAdminCan("approvals");
  const canShowConvert = canClientConvert || canApprovalsConvert;
  const [view, setView] = useState<LeadListView>("active");
  const [textLead, setTextLead] = useState<AdminLead | null>(null);
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const [eventId, setEventId] = useState("");
  // ?q= deep link (e.g. "Move back to Leads" lands on the restored lead).
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") || "");
  const [offset, setOffset] = useState(0);
  const [noteLead, setNoteLead] = useState<AdminLead | null>(null);
  const [convertLead, setConvertLead] = useState<AdminLead | null>(null);
  const [phoneMatch, setPhoneMatch] = useState<LeadConvertPhoneMatch | null>(null);
  const [pendingConvert, setPendingConvert] = useState<{
    target: LeadConvertTarget;
    adu_plan_id: number | null;
    status: LeadConvertStatus;
  } | null>(null);
  const rowBusy = useRowBusy();

  useEffect(() => {
    setOffset(0);
  }, [view, status, q, mode, eventId]);

  useEffect(() => {
    void dispatch(fetchAdminEvents({ limit: 100 }));
  }, [dispatch]);

  const load = () =>
    void dispatch(
      fetchAdminLeads({
        view,
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
  }, [view, status, q, mode, eventId, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const openConvert = (lead: AdminLead) => {
    dispatch(clearAdminSaveError());
    setPhoneMatch(null);
    setPendingConvert(null);
    void dispatch(fetchAdminPlans());
    setConvertLead(lead);
  };

  const convertInitial = useMemo(() => {
    if (!convertLead) {
      return {
        target: "client" as LeadConvertTarget,
        adu_plan_id: "",
        status: "active" as LeadConvertStatus,
      };
    }
    const target = pickDefaultTarget(convertLead, canClientConvert, canApprovalsConvert);
    return {
      target,
      adu_plan_id: "",
      status: (target === "contractor" ? "pending" : "active") as LeadConvertStatus,
    };
  }, [convertLead, canClientConvert, canApprovalsConvert]);

  const lastConvert = useRef<Parameters<typeof runConvert>[0] | null>(null);
  const runConvert = async (opts: {
    target: LeadConvertTarget;
    adu_plan_id: number | null;
    status: LeadConvertStatus;
    confirm_phone_link?: boolean;
    shared_phone_reason?: string;
  }) => {
    if (!convertLead) return;
    lastConvert.current = opts;
    const r = await dispatch(
      convertAdminLead({
        id: convertLead.id,
        target: opts.target,
        adu_plan_id: opts.target === "client" ? opts.adu_plan_id : null,
        status: opts.target === "client" ? undefined : opts.status,
        confirm_phone_link: opts.confirm_phone_link,
        shared_phone_reason: opts.shared_phone_reason,
      }),
    );
    if (convertAdminLead.fulfilled.match(r)) {
      setConvertLead(null);
      setPhoneMatch(null);
      setPendingConvert(null);
      const payload = r.payload;
      if (payload.target === "client" && payload.project_public_id) {
        navigate(`/admin/projects/${payload.project_public_id}`);
      } else if (payload.target === "affiliate" && payload.affiliate_id) {
        navigate(`/admin/affiliates/${payload.affiliate_id}`);
      } else if (payload.target === "contractor" && payload.contractor_id) {
        navigate(`/admin/contractors/${payload.contractor_id}`);
      } else {
        load();
      }
      return;
    }
    if (convertAdminLead.rejected.match(r) && r.payload?.phone_match) {
      dispatch(clearAdminSaveError());
      setPhoneMatch(r.payload.phone_match);
      setPendingConvert({
        target: opts.target,
        adu_plan_id: opts.adu_plan_id,
        status: opts.status,
      });
    }
  };

  const modalOpen = Boolean(noteLead || convertLead);

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.leads" leadKey="admin.leadsLead" />
      <DuplicatesPanel entity="lead" />
      <SegmentedTabs<LeadListView>
        value={view}
        onChange={setView}
        ariaLabel={t("admin.leadViewAria")}
        options={[
          { value: "active", labelKey: "admin.leadViewActive" },
          { value: "converted", labelKey: "admin.leadViewConverted" },
          { value: "all", labelKey: "admin.leadViewAll" },
        ]}
      />
      <p className="pf-hint">{t(`admin.leadViewHint.${view}`)}</p>
      <div className="pf-filters">
        <SearchBox value={q} onSearch={setQ} />
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
          { key: "lastText", headerKey: "admin.leadLastText", render: (l) => <LeadTouchCell touch={l.last_sms} kind="sms" /> },
          { key: "lastCall", headerKey: "admin.leadLastCall", render: (l) => <LeadTouchCell touch={l.last_call} kind="call" /> },
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
          {
            key: "date",
            headerKey: "pf.created",
            render: (l) => (
              <>
                {fmt.date(l.last_submitted_at || l.created_at)}
                {l.submission_count && l.submission_count > 1 ? (
                  <>
                    <br />
                    <span className="lead-repeat" title={t("admin.leadRepeatHint")}>
                      {t("admin.leadRepeat", { count: l.submission_count })}
                    </span>
                  </>
                ) : null}
              </>
            ),
          },
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
            render: (l) => (
              <div className="gw-lead-actions">
                {l.phone ? (
                  <>
                    <button type="button" className="pf-btn" onClick={() => setTextLead(l)}>
                      <MessageSquare size={15} /> {t("admin.leadText")}
                    </button>
                    <Link className="pf-btn" to={conversationsDialUrl({ phone: l.phone })}>
                      <Phone size={15} /> {t("admin.leadCall")}
                    </Link>
                  </>
                ) : null}
                {canShowConvert && !leadAlreadyConverted(l) ? (
                  <button type="button" className="pf-btn" onClick={() => openConvert(l)}>
                    <ArrowRightCircle size={15} /> {t("admin.convert")}
                  </button>
                ) : leadAlreadyConverted(l) ? (
                  <LeadPersonLink lead={l} />
                ) : null}
              </div>
            ),
          },
        ]}
      />
      <LeadQuickText lead={textLead} onClose={() => setTextLead(null)} onSent={load} />
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
        open={Boolean(convertLead) && !phoneMatch}
        titleKey="admin.convertLeadTitle"
        onClose={() => {
          setConvertLead(null);
          setPendingConvert(null);
        }}
      >
        {convertLead ? (
          <Formik
            enableReinitialize
            initialValues={convertInitial}
            onSubmit={async (v) => {
              await runConvert({
                target: v.target,
                adu_plan_id: v.adu_plan_id ? Number(v.adu_plan_id) : null,
                status: v.status,
              });
            }}
          >
            {({ values, setFieldValue }) => (
              <Form className="pf-form">
                <ErrorNote error={saveError} />
                <PersonConflictNotice
                  busy={saving}
                  onOverride={(reason) =>
                    lastConvert.current &&
                    void runConvert({ ...lastConvert.current, shared_phone_reason: reason })
                  }
                />
                <p className="pf-muted">
                  {t("admin.convertLeadHelp", { name: convertLead.full_name })}
                </p>
                <fieldset className="pf-fieldset">
                  <legend>{t("admin.convertTarget")}</legend>
                  <div className="pf-radio-stack">
                    {canClientConvert ? (
                      <label className="pf-radio">
                        <input
                          type="radio"
                          name="target"
                          checked={values.target === "client"}
                          onChange={() => {
                            void setFieldValue("target", "client");
                          }}
                        />
                        {t("admin.convertTargetClient")}
                      </label>
                    ) : null}
                    {canApprovalsConvert ? (
                      <label className="pf-radio">
                        <input
                          type="radio"
                          name="target"
                          checked={values.target === "affiliate"}
                          onChange={() => {
                            void setFieldValue("target", "affiliate");
                            void setFieldValue("status", "active");
                          }}
                        />
                        {t("admin.convertTargetAffiliate")}
                      </label>
                    ) : null}
                    {canApprovalsConvert ? (
                      <label className="pf-radio">
                        <input
                          type="radio"
                          name="target"
                          checked={values.target === "contractor"}
                          onChange={() => {
                            void setFieldValue("target", "contractor");
                            void setFieldValue("status", "pending");
                          }}
                        />
                        {t("admin.convertTargetContractor")}
                      </label>
                    ) : null}
                  </div>
                </fieldset>
                {values.target === "client" ? (
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
                ) : (
                  <>
                    <p className="pf-muted">
                      {values.target === "contractor"
                        ? t("admin.convertContractorStatusHelp")
                        : t("admin.convertAffiliateStatusHelp")}
                    </p>
                    <fieldset className="pf-fieldset">
                      <legend>{t("admin.convertStatus")}</legend>
                      <div className="pf-radio-stack">
                        <label className="pf-radio">
                          <input
                            type="radio"
                            name="status"
                            checked={values.status === "active"}
                            onChange={() => void setFieldValue("status", "active")}
                          />
                          {t("admin.convertStatusActive")}
                        </label>
                        <label className="pf-radio">
                          <input
                            type="radio"
                            name="status"
                            checked={values.status === "pending"}
                            onChange={() => void setFieldValue("status", "pending")}
                          />
                          {t("admin.convertStatusPending")}
                        </label>
                      </div>
                    </fieldset>
                  </>
                )}
                <SubmitButton busy={saving} labelKey="admin.convert" />
              </Form>
            )}
          </Formik>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(phoneMatch && convertLead && pendingConvert)}
        titleKey="admin.convertPhoneLinkTitle"
        onClose={() => {
          setPhoneMatch(null);
          setPendingConvert(null);
        }}
      >
        {phoneMatch && pendingConvert ? (
          <div className="pf-form">
            <ErrorNote error={saveError} />
            <p>
              {t("admin.convertPhoneLinkHelp", {
                name: phoneMatch.name,
                email: phoneMatch.email,
                entity: t(`admin.convertPhoneEntity.${phoneMatch.entity}`),
              })}
            </p>
            <div className="pf-actions" style={{ flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="pf-btn pf-btn-primary"
                disabled={saving}
                onClick={() =>
                  void runConvert({
                    ...pendingConvert,
                    confirm_phone_link: true,
                  })
                }
              >
                {t("admin.convertPhoneLinkConfirm")}
              </button>
              <button
                type="button"
                className="pf-btn"
                disabled={saving}
                onClick={() => {
                  setPhoneMatch(null);
                  setPendingConvert(null);
                }}
              >
                {t("admin.convertPhoneLinkCancel")}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/** "Already a client / affiliate / contractor" link for leads that point at a person. */
function LeadPersonLink({ lead }: { lead: AdminLead }) {
  const { t } = useTranslation();
  const target = lead.client_id
    ? { path: `/admin/clients/${lead.client_id}`, role: "client" }
    : lead.converted_affiliate_id
      ? { path: `/admin/affiliates/${lead.converted_affiliate_id}`, role: "affiliate" }
      : lead.converted_contractor_id
        ? { path: `/admin/contractors/${lead.converted_contractor_id}`, role: "contractor" }
        : null;
  if (!target) return <span className="pf-muted">{t("admin.converted")}</span>;
  return (
    <Link className={`lead-person is-${target.role}`} to={target.path}>
      {t(`admin.leadIsRole.${target.role}`)}
    </Link>
  );
}
