import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { List, Plus, SquareKanban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  createAdminProject,
  fetchAdminAffiliates,
  fetchAdminAssignees,
  fetchAdminClients,
  fetchAdminContractors,
  fetchAdminPlans,
  fetchAdminProjectBoard,
  fetchAdminProjects,
  setProjectBoardFilters,
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
  SelectField,
  StatusBadge,
  SubmitButton,
  TextField,
  enumOptions,
  milestoneOptions,
} from "@/components/portal/kit";
import ProjectsBoard from "@/components/portal/ProjectsBoard";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";
import { countActiveBoardFilters } from "@/lib/projectBoard";

const VIEW_KEY = "gw_admin_projects_view_v2";
const PAGE_SIZE = 50;
type ViewMode = "list" | "board";

const LOAN_STATUSES = [
  "not_started",
  "in_process",
  "underwriting",
  "approved",
  "finalized",
  "denied",
  "withdrawn",
] as const;

function readView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "list") return "list";
    return "board";
  } catch {
    return "board";
  }
}

export default function AdminProjects() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.projects);
  const board = useAppSelector((s) => s.adminPortal.projectBoard);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const clients = useAppSelector((s) => s.adminPortal.clients.items);
  const plans = useAppSelector((s) => s.adminPortal.plans.items);
  const affiliates = useAppSelector((s) => s.adminPortal.affiliates.items);
  const contractors = useAppSelector((s) => s.adminPortal.contractors.items);
  const assignees = useAppSelector((s) => s.adminPortal.assignees.items);
  const canWrite = useAdminCan("projects.write");
  const canFinance = useAdminCan("finance.read");
  const [view, setView] = useState<ViewMode>(() => readView());
  const [milestone, setMilestone] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);

  // List and board share one filter set so toggling views keeps the same scope.
  const filters = board.filters;
  const setFilters = (patch: Parameters<typeof setProjectBoardFilters>[0]) =>
    dispatch(setProjectBoardFilters(patch));

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  useEffect(() => {
    void dispatch(fetchAdminAffiliates({ limit: 100 }));
    void dispatch(fetchAdminContractors({ limit: 100 }));
    void dispatch(fetchAdminAssignees());
  }, [dispatch]);

  useEffect(() => {
    setOffset(0);
  }, [
    milestone,
    filters.q,
    filters.affiliate_id,
    filters.contractor_id,
    filters.assigned_admin_id,
    filters.loan_status,
  ]);

  useEffect(() => {
    if (view !== "list") return;
    void dispatch(
      fetchAdminProjects({
        q: filters.q || undefined,
        milestone: milestone || undefined,
        affiliate_id: filters.affiliate_id || undefined,
        contractor_id: filters.contractor_id || undefined,
        assigned_admin_id: filters.assigned_admin_id || undefined,
        loan_status: filters.loan_status || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    );
  }, [
    dispatch,
    view,
    milestone,
    offset,
    filters.q,
    filters.affiliate_id,
    filters.contractor_id,
    filters.assigned_admin_id,
    filters.loan_status,
  ]);

  useEffect(() => {
    if (view !== "board") return;
    void dispatch(fetchAdminProjectBoard(filters));
  }, [
    dispatch,
    view,
    filters.q,
    filters.affiliate_id,
    filters.contractor_id,
    filters.assigned_admin_id,
    filters.loan_status,
  ]);

  const openCreate = () => {
    dispatch(clearAdminSaveError());
    void dispatch(fetchAdminClients({ limit: 100 }));
    void dispatch(fetchAdminPlans());
    setOpen(true);
  };

  const schema = Yup.object({ client_id: Yup.string().required(t("validation.clientRequired")) });
  const activeFilters = countActiveBoardFilters(filters) + (milestone ? 1 : 0);

  return (
    <div className={`portal-page${view === "board" ? " portal-page--board" : ""}`}>
      <PageHeader
        titleKey="portalNav.projects"
        leadKey="admin.projectsLead"
        actions={
          <>
            <div className="pf-view-toggle" role="group" aria-label={t("admin.viewMode")}>
              <button
                type="button"
                className={`pf-view-toggle-btn${view === "list" ? " is-active" : ""}`}
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List size={16} strokeWidth={2.25} aria-hidden />
                <span className="pf-view-toggle-label">{t("admin.viewList")}</span>
              </button>
              <button
                type="button"
                className={`pf-view-toggle-btn${view === "board" ? " is-active" : ""}`}
                aria-pressed={view === "board"}
                onClick={() => setView("board")}
              >
                <SquareKanban size={16} strokeWidth={2.25} aria-hidden />
                <span className="pf-view-toggle-label">{t("admin.viewBoard")}</span>
              </button>
            </div>
            {canWrite ? (
              <HeaderAction labelKey="admin.newProject" icon={Plus} onClick={openCreate} />
            ) : null}
          </>
        }
      />

      <div className={`pf-filters${view === "board" ? " pf-filters--board" : ""}`}>
        <SearchBox value={filters.q} onSearch={(value) => setFilters({ q: value })} />
        {view === "list" ? (
          <FilterSelect
            value={milestone}
            onChange={setMilestone}
            ariaLabel={t("pf.milestone")}
            allLabel={t("admin.boardFilterMilestone")}
            options={milestoneOptions(t)}
          />
        ) : null}
        <FilterSelect
          value={filters.affiliate_id}
          onChange={(v) => setFilters({ affiliate_id: v })}
          ariaLabel={t("admin.affiliate")}
          allLabel={t("admin.boardFilterAffiliate")}
          options={affiliates.map((a) => ({
            value: a.id,
            label: `${a.first_name} ${a.last_name}`,
          }))}
        />
        <FilterSelect
          value={filters.contractor_id}
          onChange={(v) => setFilters({ contractor_id: v })}
          ariaLabel={t("admin.contractor")}
          allLabel={t("admin.boardFilterContractor")}
          options={contractors.map((c) => ({
            value: c.id,
            label: c.company || `${c.first_name} ${c.last_name}`,
          }))}
        />
        <FilterSelect
          value={filters.assigned_admin_id}
          onChange={(v) => setFilters({ assigned_admin_id: v })}
          ariaLabel={t("admin.assignee")}
          allLabel={t("admin.boardFilterAssignee")}
          options={assignees.map((a) => ({
            value: a.id,
            label: `${a.first_name} ${a.last_name}`,
          }))}
        />
        <FilterSelect
          value={filters.loan_status}
          onChange={(v) => setFilters({ loan_status: v })}
          ariaLabel={t("admin.loanStatus")}
          allLabel={t("admin.boardFilterLoan")}
          options={enumOptions(t, "loan", LOAN_STATUSES)}
        />
        {activeFilters > 0 ? (
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setMilestone("");
              setFilters({
                q: "",
                affiliate_id: "",
                contractor_id: "",
                assigned_admin_id: "",
                loan_status: "",
              });
            }}
          >
            {t("admin.boardClearFilters", { count: activeFilters })}
          </button>
        ) : null}
      </div>

      {view === "list" ? (
        <>
          <ErrorNote error={error} />
          <DataTable
            rows={items}
            loading={loading}
            emptyKey="admin.noProjects"
            rowKey={(p) => p.public_id}
            onRowClick={(p) => navigate(`/admin/projects/${p.public_id}`)}
            columns={[
              { key: "id", headerKey: "pf.project", render: (p) => <strong>{p.public_id}</strong> },
              {
                key: "client",
                headerKey: "pf.client",
                render: (p) => (
                  <>
                    {p.client_name}
                    <br />
                    <span className="pf-muted">{p.property_address || "—"}</span>
                  </>
                ),
              },
              { key: "plan", headerKey: "pf.plan", render: (p) => p.plan_name || "—" },
              { key: "aff", headerKey: "admin.affiliate", render: (p) => p.affiliate_name || "—" },
              { key: "ctr", headerKey: "admin.contractor", render: (p) => p.contractor_name || "—" },
              {
                key: "loan",
                headerKey: "admin.loan",
                render: (p) => <StatusBadge group="loan" value={p.loan_status} />,
              },
              {
                key: "milestone",
                headerKey: "pf.milestone",
                render: (p) => <StatusBadge group="milestone" value={p.milestone} />,
              },
              ...(canFinance
                ? [
                    {
                      key: "profit",
                      headerKey: "admin.netProfit",
                      render: (p: (typeof items)[number]) => fmt.money(p.net_profit_cents),
                    },
                  ]
                : []),
              { key: "date", headerKey: "pf.created", render: (p) => fmt.date(p.created_at) },
            ]}
          />
          <ListPager
            total={total}
            limit={PAGE_SIZE}
            offset={offset}
            loading={loading}
            onPageChange={setOffset}
          />
        </>
      ) : (
        <ProjectsBoard canWrite={canWrite} />
      )}

      <Modal open={open} titleKey="admin.newProject" onClose={() => setOpen(false)}>
        <Formik
          initialValues={{ client_id: "", adu_plan_id: "", property_address: "" }}
          validationSchema={schema}
          onSubmit={async (v) => {
            const r = await dispatch(
              createAdminProject({
                client_id: Number(v.client_id),
                adu_plan_id: v.adu_plan_id ? Number(v.adu_plan_id) : null,
                property_address: v.property_address.trim() || null,
              }),
            );
            if (createAdminProject.fulfilled.match(r)) {
              setOpen(false);
              navigate(`/admin/projects/${r.payload.project_public_id}`);
            }
          }}
        >
          <Form className="pf-form">
            <ErrorNote error={saveError} />
            <SelectField
              name="client_id"
              labelKey="pf.client"
              options={[
                { value: "", label: t("admin.chooseClient") },
                ...clients.map((c) => ({
                  value: c.id,
                  label: `${c.first_name} ${c.last_name} · ${c.email}`,
                })),
              ]}
            />
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
            <TextField name="property_address" labelKey="form.address" />
            <SubmitButton busy={saving} labelKey="pf.create" />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
