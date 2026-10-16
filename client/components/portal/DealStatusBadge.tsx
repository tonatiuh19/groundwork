import { useTranslation } from "react-i18next";
import type { DealStatusTone } from "@shared/api";

const TONE: Record<DealStatusTone, string> = { neutral: "muted", warn: "warn", bad: "bad", good: "good" };

/** Deal status chip (Credit repair, Not enough equity, …) in the viewer's language. */
export default function DealStatusBadge({
  en,
  es,
  tone,
}: {
  en?: string | null;
  es?: string | null;
  tone?: DealStatusTone | null;
}) {
  const { i18n } = useTranslation();
  const label = i18n.language?.startsWith("es") ? es || en : en || es;
  if (!label) return null;
  return <span className={`pf-badge pf-badge--${TONE[tone || "warn"]} gw-deal-badge`}>{label}</span>;
}
