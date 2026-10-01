import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchClientOverview } from "@/store/slices/clientPortalSlice";
import {
  EmptyState,
  ErrorNote,
  Loading,
  MilestoneTracker,
  PageHeader,
  StatusBadge,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

export default function ClientProject() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { overview, loading, error } = useAppSelector((s) => s.clientPortal);

  useEffect(() => {
    void dispatch(fetchClientOverview());
  }, [dispatch]);

  const projects = overview?.projects ?? [];

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.myProject" leadKey="cli.projectLead" />
      <ErrorNote error={error} />
      {loading && !overview ? <Loading /> : null}
      {overview && !projects.length ? <EmptyState messageKey="cli.noProject" /> : null}
      {projects.map((p) => (
        <section key={p.public_id} className="pf-section">
          <div className="pf-card-top">
            <div>
              <p className="pf-kicker">{p.public_id}</p>
              <h2>{p.property_address || t("cli.addressPending")}</h2>
            </div>
            <StatusBadge group="milestone" value={p.milestone} />
          </div>
          <MilestoneTracker milestone={p.milestone} />

          {p.plan ? (
            <div className="pf-plan">
              {p.plan.exterior_image_url ? (
                <img src={p.plan.exterior_image_url} alt={p.plan.name} loading="lazy" />
              ) : null}
              <div>
                <h3>{p.plan.name}</h3>
                <dl className="pf-dl">
                  <div>
                    <dt>{t("cli.bedrooms")}</dt>
                    <dd>{p.plan.bedrooms}</dd>
                  </div>
                  <div>
                    <dt>{t("cli.bathrooms")}</dt>
                    <dd>{p.plan.bathrooms}</dd>
                  </div>
                  <div>
                    <dt>{t("pf.sqft")}</dt>
                    <dd>{p.plan.sq_ft}</dd>
                  </div>
                  <div>
                    <dt>{t("cli.stories")}</dt>
                    <dd>{p.plan.stories}</dd>
                  </div>
                </dl>
                {p.plan.layout_image_url ? (
                  <img
                    className="pf-plan-layout"
                    src={p.plan.layout_image_url}
                    alt={t("cli.layoutAlt")}
                    loading="lazy"
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <h3>{t("cli.timeline")}</h3>
          <ol className="pf-timeline">
            {[...p.events].reverse().map((e) => (
              <li key={e.id}>
                <strong>{t(`milestone.${e.to_milestone}`, { defaultValue: e.to_milestone })}</strong>
                <span>{fmt.date(e.created_at)}</span>
                {e.note ? <em>{e.note}</em> : null}
              </li>
            ))}
          </ol>

          <h3>{t("cli.photos")}</h3>
          {p.photos.length ? (
            <div className="pf-gallery">
              {p.photos.map((ph) => (
                <figure key={ph.id}>
                  <img src={ph.storage_url} alt={ph.caption || t("cli.photoAlt")} loading="lazy" />
                  {ph.caption ? <figcaption>{ph.caption}</figcaption> : null}
                </figure>
              ))}
            </div>
          ) : (
            <EmptyState messageKey="cli.noPhotos" />
          )}
        </section>
      ))}
    </div>
  );
}
