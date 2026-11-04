import { useParams } from "react-router-dom";
import { BackLink, PageHeader } from "@/components/portal/kit";
import CityPipelineBoard from "@/components/city/CityPipelineBoard";
import CityDetailView from "@/components/city/CityDetailView";

/** Admin → City pipeline: every city being opened, with its activity log and city sheet. */
export default function CityPipeline() {
  return (
    <div className="portal-page">
      <PageHeader titleKey="cityPartner.pipelineTitle" leadKey="cityPartner.pipelineLead" />
      <CityPipelineBoard scope="admin" linkBase="/admin/city-pipeline" />
    </div>
  );
}

export function CityPipelineCity() {
  const id = Number(useParams().id);
  return (
    <div className="portal-page">
      <BackLink to="/admin/city-pipeline" />
      <CityDetailView scope="admin" id={id} />
    </div>
  );
}
