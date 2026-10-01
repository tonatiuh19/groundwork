import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchContractorDraws,
  fetchContractorProjects,
  submitContractorDraw,
} from "@/store/slices/contractorPortalSlice";
import { DataTable, ErrorNote, PageHeader, StatusBadge, BusyButton, useRowBusy } from "@/components/portal/kit";
import { DrawForm } from "@/components/portal/ContractorForms";
import { useFormatters } from "@/lib/format";

export default function ContractorDraws() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { draws, projects, loading, error, saveError } = useAppSelector((s) => s.contractorPortal);
  const rowBusy = useRowBusy();

  const reload = () => void dispatch(fetchContractorDraws());
  useEffect(() => {
    reload();
    void dispatch(fetchContractorProjects());
  }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.draws" leadKey="ctr.drawsLead" />
      <ErrorNote error={error || saveError} />
      <section className="pf-card">
        <h3>{t("ctr.requestDraw")}</h3>
        <DrawForm
          projects={projects.filter((p) => ["contracted", "in_build"].includes(p.milestone))}
          onDone={reload}
        />
      </section>
      <DataTable
        rows={draws}
        loading={loading}
        emptyKey="ctr.noDraws"
        rowKey={(d) => d.id}
        columns={[
          {
            key: "project",
            headerKey: "pf.project",
            render: (d) => (
              <Link className="text-link" to={`/contractor/projects/${d.project_public_id}`}>
                {d.project_public_id}
              </Link>
            ),
          },
          { key: "amount", headerKey: "pf.amount", render: (d) => <strong>{fmt.money(d.amount_cents)}</strong> },
          { key: "status", headerKey: "pf.status", render: (d) => <StatusBadge group="drawStatus" value={d.status} /> },
          { key: "note", headerKey: "pf.notes", render: (d) => d.note || "—" },
          { key: "date", headerKey: "pf.date", render: (d) => fmt.date(d.created_at) },
          {
            key: "act",
            headerKey: "pf.actions",
            render: (d) =>
              d.status === "draft" || rowBusy.isDone(d.id, "submit") ? (
                <BusyButton
                  tone="gold"
                  label={t("ctr.submitDraw")}
                  busyLabel={t("pf.busy.submitting")}
                  doneLabel={t("pf.done.submitted")}
                  busy={rowBusy.isBusy(d.id, "submit")}
                  done={rowBusy.isDone(d.id, "submit")}
                  onClick={() => {
                    void rowBusy.run(
                      d.id,
                      "submit",
                      async () => {
                        const r = await dispatch(submitContractorDraw(d.id));
                        return submitContractorDraw.fulfilled.match(r);
                      },
                      { flash: true, onFlashEnd: reload },
                    );
                  }}
                />
              ) : null,
          },
        ]}
      />
    </div>
  );
}
