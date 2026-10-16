import { useEffect } from "react";
import AppointmentsPanel from "@/components/admin/AppointmentsPanel";
import { fetchLenders } from "@/store/slices/schedulerSlice";
import { Link, useParams } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdminProject } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminProject,
  clearAdminSaveError,
  fetchAdminAffiliates,
  fetchAdminAssignees,
  fetchAdminContractors,
  fetchAdminPlans,
  fetchAdminProject,
  generateContract,
  syncAdminProjectAnchor,
  updateAdminProject,
  updateContract,
} from "@/store/slices/adminPortalSlice";
import {
  BusyButton,
  DataTable,
  EmptyState,
  ErrorNote,
  Loading,
  MilestoneTracker,
  PageHeader,
  PdfLink,
  SelectField,
  StatCard,
  StatusBadge,
  SubmitButton,
  TextField,
  enumOptions,
  milestoneOptions,
  useBusyAction,
  useRowBusy,
} from "@/components/portal/kit";
import { CommissionActions, DrawActions } from "@/components/portal/AdminActions";
import { centsToDollars, dollarsToCents, useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const LOAN_STATUSES = [
  "not_started",
  "in_process",
  "underwriting",
  "approved",
  "finalized",
  "denied",
  "withdrawn",
] as const;
const LENDER_TYPES = ["anchor", "external", "unknown"] as const;

const idOrNull = (v: string) => (v ? Number(v) : null);

export default function AdminProjectDetail() {
  const { t } = useTranslation();
  const { publicId: rawId = "" } = useParams();
  const publicId = rawId.toUpperCase();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { data, loading, error } = useAppSelector((s) => s.adminPortal.projectDetail);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const contractors = useAppSelector((s) => s.adminPortal.contractors.items);
  const lenders = useAppSelector((s) => s.scheduler.lenders);
  const affiliates = useAppSelector((s) => s.adminPortal.affiliates.items);
  const assignees = useAppSelector((s) => s.adminPortal.assignees.items);
  const plans = useAppSelector((s) => s.adminPortal.plans.items);
  const canWrite = useAdminCan("projects.write");
  const canFinanceRead = useAdminCan("finance.read");
  const canFinanceWrite = useAdminCan("finance.write");
  const anchorSync = useBusyAction(900);
  const generateBusy = useBusyAction(900);
  const contractBusy = useRowBusy();

  const reload = () => void dispatch(fetchAdminProject(publicId));
  useEffect(() => {
    dispatch(clearAdminSaveError());
    dispatch(clearAdminProject());
    reload();
    void dispatch(fetchAdminContractors({ status: "active", limit: 100 }));
    void dispatch(fetchAdminAffiliates({ status: "active", limit: 100 }));
    void dispatch(fetchAdminAssignees());
    void dispatch(fetchAdminPlans());
    void dispatch(fetchLenders());
  }, [dispatch, publicId]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = data?.project.public_id === publicId ? data : null;
  const p: AdminProject | undefined = d?.project;

  const opsSchema = Yup.object({
    sq_ft: Yup.number().nullable().integer().min(1),
  });

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="admin.projectTitle"
        title={p?.public_id}
        leadKey="admin.projectDetailLead"
      />
      <Link className="text-link pf-back" to="/admin/projects">
        <ArrowLeft size={14} /> {t("pf.back")}
      </Link>
      <ErrorNote error={error} />
      {loading && !d ? <Loading /> : null}
      {d && p ? (
        <>
          <section className="pf-card">
            <div className="pf-card-top">
              <div>
                <p className="pf-kicker">{p.public_id}</p>
                <h2>{p.client_name}</h2>
                <p className="pf-muted">
                  {p.client_email} · {p.property_address || "—"}
                </p>
              </div>
              <StatusBadge group="milestone" value={p.milestone} />
            </div>
            <MilestoneTracker milestone={p.milestone} />
          </section>

          {canFinanceRead ? (
            <div className="pf-stats">
              <StatCard labelKey="admin.salePrice" value={fmt.money(p.sale_price_cents)} />
              <StatCard labelKey="admin.contractorCost" value={fmt.money(p.contractor_cost_cents)} />
              <StatCard labelKey="admin.affiliateCommission" value={p.affiliate_id ? fmt.money(p.affiliate_commission_cents) : "—"} />
              <StatCard labelKey="admin.agentCommission" value={fmt.money(p.agent_commission_cents)} />
              <StatCard labelKey="admin.netProfit" value={fmt.money(p.net_profit_cents)} tone="gold" />
              <StatCard labelKey="admin.netPerSqft" value={fmt.money(p.net_profit_per_sqft_cents)} tone="gold" />
            </div>
          ) : null}

          <ErrorNote error={saveError} />

          <section className="pf-section">
            <h2 className="pf-h2">{t("admin.operations")}</h2>
            <Formik
              enableReinitialize
              initialValues={{
                milestone: p.milestone,
                contractor_id: p.contractor_id ? String(p.contractor_id) : "",
                affiliate_id: p.affiliate_id ? String(p.affiliate_id) : "",
                assigned_admin_id: p.assigned_admin_id ? String(p.assigned_admin_id) : "",
                adu_plan_id: p.adu_plan_id ? String(p.adu_plan_id) : "",
                sq_ft: p.sq_ft ?? "",
                property_address: p.property_address || "",
                property_city: p.property_city || "",
                property_state: p.property_state || "",
                property_zip: p.property_zip || "",
                loan_status: p.loan_status,
                loan_lender_type: p.loan_lender_type,
                loan_lender_name: p.loan_lender_name || "",
                lender_id: p.lender_id ? String(p.lender_id) : "",
                anchor_external_id: p.anchor_external_id || "",
                notes: p.notes || "",
              }}
              validationSchema={opsSchema}
              onSubmit={async (v) => {
                await dispatch(
                  updateAdminProject({
                    publicId,
                    patch: {
                      milestone: v.milestone,
                      contractor_id: idOrNull(v.contractor_id),
                      affiliate_id: idOrNull(v.affiliate_id),
                      assigned_admin_id: idOrNull(v.assigned_admin_id),
                      adu_plan_id: idOrNull(v.adu_plan_id),
                      sq_ft: v.sq_ft === "" ? null : Number(v.sq_ft),
                      property_address: v.property_address.trim() || null,
                      property_city: v.property_city.trim() || null,
                      property_state: v.property_state.trim() || null,
                      property_zip: v.property_zip.trim() || null,
                      loan_status: v.loan_status,
                      loan_lender_type: v.loan_lender_type,
                      // Directory pick wins (server syncs the name); free text otherwise.
                      ...(v.lender_id
                        ? { lender_id: Number(v.lender_id) }
                        : { lender_id: null, loan_lender_name: v.loan_lender_name.trim() || null }),
                      anchor_external_id: v.anchor_external_id.trim() || null,
                      notes: v.notes.trim() || null,
                    },
                  }),
                );
              }}
            >
              <Form className="pf-form pf-card">
                <div className="pf-form-grid">
                  <SelectField name="milestone" labelKey="pf.milestone" options={milestoneOptions(t)} disabled={!canWrite} />
                  <SelectField
                    name="contractor_id"
                    labelKey="admin.contractor"
                    disabled={!canWrite}
                    options={[
                      { value: "", label: t("pf.none") },
                      ...contractors
                        .filter((c) => c.status === "active" || c.id === p.contractor_id)
                        .map((c) => ({ value: c.id, label: c.company || `${c.first_name} ${c.last_name}` })),
                    ]}
                  />
                  <SelectField
                    name="affiliate_id"
                    labelKey="admin.affiliate"
                    disabled={!canWrite || p.loan_status === "finalized"}
                    options={[
                      { value: "", label: t("pf.none") },
                      ...affiliates
                        .filter((a) => a.status === "active" || a.id === p.affiliate_id)
                        .map((a) => ({ value: a.id, label: `${a.first_name} ${a.last_name}` })),
                    ]}
                  />
                  <SelectField
                    name="assigned_admin_id"
                    labelKey="admin.assignee"
                    disabled={!canWrite}
                    options={[
                      { value: "", label: t("pf.none") },
                      ...assignees.map((a) => ({
                        value: a.id,
                        label: `${a.first_name} ${a.last_name}`,
                      })),
                    ]}
                  />
                  <SelectField
                    name="adu_plan_id"
                    labelKey="pf.plan"
                    disabled={!canWrite}
                    options={[
                      { value: "", label: t("pf.none") },
                      ...plans.map((pl) => ({ value: pl.id, label: pl.name })),
                    ]}
                  />
                </div>
                <div className="pf-form-grid">
                  <TextField name="property_address" labelKey="form.address" disabled={!canWrite} />
                  <TextField name="property_city" labelKey="pf.city" disabled={!canWrite} />
                  <TextField name="property_state" labelKey="pf.state" disabled={!canWrite} />
                  <TextField name="property_zip" labelKey="pf.zip" disabled={!canWrite} />
                  <TextField name="sq_ft" labelKey="pf.sqft" type="number" disabled={!canWrite} />
                </div>
                <h3>{t("admin.loan")}</h3>
                <div className="pf-form-grid">
                  <SelectField name="loan_status" labelKey="admin.loanStatus" options={enumOptions(t, "loan", LOAN_STATUSES)} disabled={!canWrite} />
                  <SelectField name="loan_lender_type" labelKey="admin.lenderType" options={enumOptions(t, "lenderType", LENDER_TYPES)} disabled={!canWrite} />
                  <SelectField
                    name="lender_id"
                    labelKey="lenders.pick"
                    disabled={!canWrite}
                    options={[
                      { value: "", label: t("lenders.notInList") },
                      ...lenders.filter((l) => l.is_active || l.id === p.lender_id).map((l) => ({ value: String(l.id), label: l.company })),
                    ]}
                  />
                  <TextField name="loan_lender_name" labelKey="admin.lenderName" disabled={!canWrite} />
                  <TextField name="anchor_external_id" labelKey="admin.anchorId" disabled={!canWrite} />
                </div>
                {canWrite && p.loan_lender_type === "anchor" ? (
                  <div className="pf-actions">
                    <BusyButton
                      label={t("admin.anchorSync")}
                      busyLabel={t("pf.busy.syncing")}
                      doneLabel={t("pf.done.synced")}
                      busy={anchorSync.busy}
                      done={anchorSync.done}
                      disabled={!p.anchor_external_id || saving}
                      onClick={() => {
                        void anchorSync.run(async () => {
                          const r = await dispatch(syncAdminProjectAnchor(publicId));
                          return syncAdminProjectAnchor.fulfilled.match(r);
                        }, { flash: true, onFlashEnd: reload });
                      }}
                    />
                    {p.anchor_last_synced_at ? (
                      <span className="pf-muted">
                        {t("admin.anchorLastSynced", {
                          when: fmt.date(p.anchor_last_synced_at),
                        })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <p className="pf-muted">{t("admin.loanHelp")}</p>
                <TextField name="notes" labelKey="pf.notes" as="textarea" rows={3} disabled={!canWrite} />
                {canWrite ? <SubmitButton busy={saving} labelKey="pf.save" /> : null}
              </Form>
            </Formik>
          </section>

          <AppointmentsPanel context={{ project_id: p.id, client_id: p.client_id ?? null, label: p.client_name || p.public_id }} />

          {canFinanceWrite ? (
            <section className="pf-section">
              <h2 className="pf-h2">{t("admin.finance")}</h2>
              <Formik
                enableReinitialize
                initialValues={{
                  sale_price: centsToDollars(p.sale_price_cents),
                  contractor_cost: centsToDollars(p.contractor_cost_cents),
                  agent_commission: centsToDollars(p.agent_commission_cents),
                  commission_override: centsToDollars(p.commission_override_cents),
                }}
                onSubmit={async (v) => {
                  await dispatch(
                    updateAdminProject({
                      publicId,
                      patch: {
                        sale_price_cents: dollarsToCents(v.sale_price),
                        contractor_cost_cents: dollarsToCents(v.contractor_cost),
                        agent_commission_cents: dollarsToCents(v.agent_commission),
                        commission_override_cents: dollarsToCents(v.commission_override),
                      },
                    }),
                  );
                }}
              >
                <Form className="pf-form pf-card">
                  <div className="pf-form-grid">
                    <TextField name="sale_price" labelKey="admin.salePrice" placeholder="0.00" />
                    <TextField name="contractor_cost" labelKey="admin.contractorCost" placeholder="0.00" />
                    <TextField name="agent_commission" labelKey="admin.agentCommission" placeholder="0.00" />
                    <TextField name="commission_override" labelKey="admin.commissionOverride" placeholder="0.00" />
                  </div>
                  <p className="pf-muted">{t("admin.financeHelp")}</p>
                  <SubmitButton busy={saving} labelKey="pf.save" />
                </Form>
              </Formik>
            </section>
          ) : null}

          {(d.commissions?.length ? d.commissions : d.commission ? [d.commission] : [])
            .length > 0 ? (
            <section className="pf-section">
              <h2 className="pf-h2">{t("admin.affiliateCommission")}</h2>
              <div className="pf-section-stack">
                {(d.commissions?.length ? d.commissions : d.commission ? [d.commission] : []).map(
                  (c) => (
                    <div key={c.id} className="pf-card pf-card-top">
                      <div>
                        <strong>{fmt.money(c.amount_cents)}</strong>{" "}
                        {c.role ? <StatusBadge group="commRole" value={c.role} /> : null}{" "}
                        <StatusBadge group="commStatus" value={c.status} />
                        {c.affiliate_name ? (
                          <p className="pf-muted">{c.affiliate_name}</p>
                        ) : null}
                        <p className="pf-muted">
                          {t("aff.expectedPay")}: {fmt.date(c.paid_at || c.expected_pay_at)}
                        </p>
                      </div>
                      <CommissionActions commission={c} onDone={reload} />
                    </div>
                  ),
                )}
              </div>
            </section>
          ) : null}

          <section className="pf-section">
            <div className="pf-section-head">
              <h2 className="pf-h2">{t("ctr.contracts")}</h2>
              {canWrite ? (
                <BusyButton
                  icon={FilePlus2}
                  label={t("admin.generateContract")}
                  busyLabel={t("pf.busy.generatingContract")}
                  doneLabel={t("pf.done.generated")}
                  busy={generateBusy.busy}
                  done={generateBusy.done}
                  disabled={saving}
                  onClick={() => {
                    void generateBusy.run(async () => {
                      const r = await dispatch(generateContract(publicId));
                      return generateContract.fulfilled.match(r);
                    }, { flash: true, onFlashEnd: reload });
                  }}
                />
              ) : null}
            </div>
            <DataTable
              rows={d.contracts}
              emptyKey="ctr.noContracts"
              rowKey={(c) => c.id}
              columns={[
                { key: "kind", headerKey: "cli.docType", render: (c) => t(`contractKind.${c.kind}`) },
                { key: "status", headerKey: "pf.status", render: (c) => <StatusBadge group="contractStatus" value={c.status} /> },
                { key: "date", headerKey: "pf.date", render: (c) => fmt.date(c.generated_at) },
                {
                  key: "act",
                  headerKey: "pf.actions",
                  render: (c) => (
                    <div className="pf-actions">
                      <PdfLink path={`/admin/contracts/${c.id}/pdf`} />
                      {canWrite && c.status !== "signed" && c.status !== "void" ? (
                        <>
                          {c.status === "generated" ? (
                            <BusyButton
                              label={t("admin.markSent")}
                              busyLabel={t("pf.busy.markingSent")}
                              doneLabel={t("pf.done.sent")}
                              busy={contractBusy.isBusy(c.id, "sent")}
                              done={contractBusy.isDone(c.id, "sent")}
                              disabled={contractBusy.isRowLocked(c.id) && !contractBusy.isBusy(c.id, "sent") && !contractBusy.isDone(c.id, "sent")}
                              onClick={() => {
                                void contractBusy.run(
                                  c.id,
                                  "sent",
                                  async () => {
                                    const r = await dispatch(
                                      updateContract({ id: c.id, patch: { status: "sent" } }),
                                    );
                                    return updateContract.fulfilled.match(r);
                                  },
                                  { flash: true, onFlashEnd: reload },
                                );
                              }}
                            />
                          ) : null}
                          <BusyButton
                            tone="gold"
                            label={t("admin.markSigned")}
                            busyLabel={t("pf.busy.markingSigned")}
                            doneLabel={t("pf.done.signed")}
                            busy={contractBusy.isBusy(c.id, "signed")}
                            done={contractBusy.isDone(c.id, "signed")}
                            disabled={contractBusy.isRowLocked(c.id) && !contractBusy.isBusy(c.id, "signed") && !contractBusy.isDone(c.id, "signed")}
                            onClick={() => {
                              void contractBusy.run(
                                c.id,
                                "signed",
                                async () => {
                                  const r = await dispatch(
                                    updateContract({ id: c.id, patch: { status: "signed" } }),
                                  );
                                  return updateContract.fulfilled.match(r);
                                },
                                { flash: true, onFlashEnd: reload },
                              );
                            }}
                          />
                          <BusyButton
                            label={t("admin.void")}
                            busyLabel={t("pf.busy.voiding")}
                            doneLabel={t("pf.done.voided")}
                            busy={contractBusy.isBusy(c.id, "void")}
                            done={contractBusy.isDone(c.id, "void")}
                            disabled={contractBusy.isRowLocked(c.id) && !contractBusy.isBusy(c.id, "void") && !contractBusy.isDone(c.id, "void")}
                            onClick={() => {
                              void contractBusy.run(
                                c.id,
                                "void",
                                async () => {
                                  const r = await dispatch(
                                    updateContract({ id: c.id, patch: { status: "void" } }),
                                  );
                                  return updateContract.fulfilled.match(r);
                                },
                                { flash: true, onFlashEnd: reload },
                              );
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
            <p className="pf-muted">{t("admin.contractStubNote")}</p>
          </section>

          <section className="pf-section">
            <h2 className="pf-h2">{t("ctr.draws")}</h2>
            <DataTable
              rows={d.draws}
              emptyKey="ctr.noDraws"
              rowKey={(x) => x.id}
              columns={[
                { key: "amount", headerKey: "pf.amount", render: (x) => <strong>{fmt.money(x.amount_cents)}</strong> },
                { key: "note", headerKey: "pf.notes", render: (x) => x.note || "—" },
                { key: "status", headerKey: "pf.status", render: (x) => <StatusBadge group="drawStatus" value={x.status} /> },
                { key: "date", headerKey: "pf.date", render: (x) => fmt.date(x.created_at) },
                { key: "act", headerKey: "pf.actions", render: (x) => <DrawActions draw={x} onDone={reload} /> },
              ]}
            />
          </section>

          <section className="pf-section pf-two-col">
            <div>
              <h2 className="pf-h2">{t("ctr.photos")}</h2>
              {d.photos.length ? (
                <div className="pf-gallery">
                  {d.photos.map((ph) => (
                    <figure key={ph.id}>
                      <img src={ph.storage_url} alt={ph.caption || t("cli.photoAlt")} loading="lazy" />
                      {ph.caption ? <figcaption>{ph.caption}</figcaption> : null}
                    </figure>
                  ))}
                </div>
              ) : (
                <EmptyState messageKey="ctr.noPhotos" />
              )}
            </div>
            <div>
              <h2 className="pf-h2">{t("cli.timeline")}</h2>
              <ol className="pf-timeline">
                {[...d.events].reverse().map((e) => (
                  <li key={e.id}>
                    <strong>{t(`milestone.${e.to_milestone}`, { defaultValue: e.to_milestone })}</strong>
                    <span>
                      {fmt.date(e.created_at)} · {t(`actor.${e.changed_by_type}`, { defaultValue: e.changed_by_type })}
                    </span>
                    {e.note ? <em>{e.note}</em> : null}
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
