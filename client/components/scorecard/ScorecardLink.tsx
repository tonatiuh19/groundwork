import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScorecardEnabled } from "@/hooks/useScorecardEnabled";

/** "Scorecard" button on an affiliate / contractor record (only when scorecards are on). */
export default function ScorecardLink({ type, id }: { type: "affiliate" | "contractor"; id: number }) {
  const { t } = useTranslation();
  if (!useScorecardEnabled()) return null;
  return (
    <Link className="pf-btn" to={`/admin/scorecards/${type}/${id}`}>
      <Trophy size={15} aria-hidden /> {t("scorecards.openScorecard")}
    </Link>
  );
}
