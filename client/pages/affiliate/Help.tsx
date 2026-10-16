import { PageHeader } from "@/components/portal/kit";
import AffiliateHelpPanel from "@/components/affiliate/AffiliateHelpPanel";

/** Affiliate portal → Help: FAQ + assistant (answers from the agreement + FAQ). */
export default function AffiliateHelp() {
  return (
    <div className="portal-page">
      <PageHeader titleKey="affHelp.title" leadKey="affHelp.lead" />
      <AffiliateHelpPanel />
    </div>
  );
}
