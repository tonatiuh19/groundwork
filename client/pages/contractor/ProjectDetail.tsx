import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchContractorProject, submitContractorDraw } from "@/store/slices/contractorPortalSlice";
import {
  BusyButton,
  DataTable,
  PdfLink,
  EmptyState,
  ErrorNote,
  Loading,
  MilestoneTracker,
  PageHeader,
  StatusBadge,
  useRowBusy,
} from "@/components/portal/kit";
import { DrawForm, PhotoForm } from "@/components/portal/ContractorForms";
import { useFormatters } from "@/lib/format";

export default function ContractorProjectDetail() {
  const { t } = useTranslation();
  const { publicId: rawId = "" } = useParams();
  const publicId = rawId.toUpperCase();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { detail, loading, error, saveError } = useAppSelector((s) => s.contractorPortal);
  const rowBusy = useRowBusy();

  const reload = () => void dispatch(fetchContractorProject(publicId));
  useEffect(reload, [dispatch, publicId]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = detail?.project.public_id === publicId ? detail : null;
  const canDraw = d && ["contracted", "in_build"].includes(d.project.milestone);

  return (
    <div className="portal-page">
      <PageHeader titleKey="ctr.projectTitle" />
      <Link className="text-link pf-back" to="/contractor/projects">
        <ArrowLeft size={14} /> {t("pf.back")}
      </Link>
      <ErrorNote error={error || saveError} />
      {loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <section className="pf-card">
            <div className="pf-card-top">
              <div>
                <p className="pf-kicker">{d.project.public_id}</p>
                <h2>{d.project.property_address || "—"}</h2>
                <p className="pf-muted">
                  {[d.project.property_city, d.project.property_zip].filter(Boolean).join(" ")}
                </p>
              </div>
              <StatusBadge group="milestone" value={d.project.milestone} />
            </div>
            <MilestoneTracker milestone={d.project.milestone} />
            <dl className="pf-dl">
              <div><dt>{t("pf.client")}</dt><dd>{d.project.client_name}</dd></div>
              <div><dt>{t("pf.phone")}</dt><dd>{d.project.client_phone || "—"}</dd></div>
              <div><dt>{t("pf.plan")}</dt><dd>{d.project.plan_name || "—"}</dd></div>
              <div><dt>{t("pf.sqft")}</dt><dd>{d.project.sq_ft ?? "—"}</dd></div>
              <div><dt>{t("ctr.budget")}</dt><dd>{fmt.money(d.project.budget_cents)}</dd></div>
              <div><dt>{t("ctr.drawn")}</dt><dd>{fmt.money(d.project.drawn_cents)}</dd></div>
            </dl>
          </section>

          <section className="pf-section">
            <h2 className="pf-h2">{t("ctr.contracts")}</h2>
            <DataTable
              rows={d.contracts}
              emptyKey="ctr.noContracts"
              rowKey={(c) => c.id}
              columns={[
                { key: "kind", headerKey: "cli.docType", render: (c) => t(`contractKind.${c.kind}`) },
                { key: "status", headerKey: "pf.status", render: (c) => <StatusBadge group="contractStatus" value={c.status} /> },
                { key: "date", headerKey: "pf.date", render: (c) => fmt.date(c.generated_at) },
                {
                  key: "open",
                  headerKey: "pf.actions",
                  render: (c) => (
                    <div className="pf-actions">
                      <PdfLink path={`/contractor/contracts/${c.id}/pdf`} />
                      {c.storage_url ? (
                        <a className="text-link" href={c.storage_url} target="_blank" rel="noreferrer">
                          {t("pf.open")}
                        </a>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          </section>

          <section className="pf-section pf-two-col">
            <div>
              <h2 className="pf-h2">{t("ctr.draws")}</h2>
              <DataTable
                rows={d.draws}
                emptyKey="ctr.noDraws"
                rowKey={(x) => x.id}
                columns={[
                  { key: "amount", headerKey: "pf.amount", render: (x) => <strong>{fmt.money(x.amount_cents)}</strong> },
                  { key: "status", headerKey: "pf.status", render: (x) => <StatusBadge group="drawStatus" value={x.status} /> },
                  { key: "date", headerKey: "pf.date", render: (x) => fmt.date(x.created_at) },
                  {
                    key: "act",
                    headerKey: "pf.actions",
                    render: (x) =>
                      x.status === "draft" || rowBusy.isDone(x.id, "submit") ? (
                        <BusyButton
                          tone="gold"
                          label={t("ctr.submitDraw")}
                          busyLabel={t("pf.busy.submitting")}
                          doneLabel={t("pf.done.submitted")}
                          busy={rowBusy.isBusy(x.id, "submit")}
                          done={rowBusy.isDone(x.id, "submit")}
                          onClick={() => {
                            void rowBusy.run(
                              x.id,
                              "submit",
                              async () => {
                                const r = await dispatch(submitContractorDraw(x.id));
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
            <div className="pf-card">
              <h3>{t("ctr.requestDraw")}</h3>
              {canDraw ? (
                <DrawForm projects={[]} fixedProject={publicId} onDone={reload} />
              ) : (
                <EmptyState messageKey="ctr.drawsLocked" />
              )}
            </div>
          </section>

          <section className="pf-section pf-two-col">
            <div>
              <h2 className="pf-h2">{t("ctr.photos")}</h2>
              {d.photos.length ? (
                <div className="pf-gallery">
                  {d.photos.map((p) => (
                    <figure key={p.id}>
                      <img src={p.storage_url} alt={p.caption || t("cli.photoAlt")} loading="lazy" />
                      {p.caption ? <figcaption>{p.caption}</figcaption> : null}
                    </figure>
                  ))}
                </div>
              ) : (
                <EmptyState messageKey="ctr.noPhotos" />
              )}
            </div>
            <div className="pf-card">
              <h3>{t("ctr.addPhoto")}</h3>
              <PhotoForm projects={[]} fixedProject={publicId} onDone={reload} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
