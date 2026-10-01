import { useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchClientDocuments } from "@/store/slices/clientPortalSlice";
import { DataTable, ErrorNote, PageHeader, PdfLink, StatusBadge } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

export default function ClientDocuments() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { documents, loading, error } = useAppSelector((s) => s.clientPortal);

  useEffect(() => {
    void dispatch(fetchClientDocuments());
  }, [dispatch]);

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.documents" leadKey="cli.documentsLead" />
      <ErrorNote error={error} />
      <DataTable
        rows={documents}
        loading={loading}
        emptyKey="cli.noDocuments"
        rowKey={(d) => d.id}
        columns={[
          { key: "kind", headerKey: "cli.docType", render: (d) => t(`contractKind.${d.kind}`) },
          { key: "project", headerKey: "pf.project", render: (d) => d.project_public_id },
          { key: "status", headerKey: "pf.status", render: (d) => <StatusBadge group="contractStatus" value={d.status} /> },
          { key: "date", headerKey: "pf.date", render: (d) => fmt.date(d.signed_at || d.generated_at) },
          {
            key: "open",
            headerKey: "pf.actions",
            render: (d) => (
              <div className="pf-actions">
                <PdfLink path={`/client/documents/${d.id}/pdf`} />
                {d.storage_url ? (
                  <a className="text-link" href={d.storage_url} target="_blank" rel="noreferrer">
                    {t("pf.open")} <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
