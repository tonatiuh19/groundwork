import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchContractorPhotos, fetchContractorProjects } from "@/store/slices/contractorPortalSlice";
import { EmptyState, ErrorNote, PageHeader } from "@/components/portal/kit";
import { PhotoForm } from "@/components/portal/ContractorForms";

export default function ContractorPhotos() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { photos, projects, error } = useAppSelector((s) => s.contractorPortal);

  const reload = () => void dispatch(fetchContractorPhotos());
  useEffect(() => {
    reload();
    void dispatch(fetchContractorProjects());
  }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.photos" leadKey="ctr.photosLead" />
      <ErrorNote error={error} />
      <section className="pf-card">
        <h3>{t("ctr.addPhoto")}</h3>
        <PhotoForm
          projects={projects.filter((p) => p.milestone !== "cancelled")}
          onDone={reload}
        />
        <p className="pf-muted">{t("ctr.photoHint")}</p>
      </section>
      {photos.length ? (
        <div className="pf-gallery">
          {photos.map((p) => (
            <figure key={p.id}>
              <img src={p.storage_url} alt={p.caption || t("cli.photoAlt")} loading="lazy" />
              <figcaption>
                <Link className="text-link" to={`/contractor/projects/${p.project_public_id}`}>
                  {p.project_public_id}
                </Link>
                {p.caption ? ` · ${p.caption}` : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <EmptyState messageKey="ctr.noPhotos" />
      )}
    </div>
  );
}
