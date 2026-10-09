import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorNote } from "@/components/portal/kit";
import { cn } from "@/lib/cn";
import { useFormatters } from "@/lib/format";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPortalApplicationSummary,
  openPortalApplication,
} from "@/store/slices/contractorApplicationSlice";

/** Contractor portal nudge: finish / follow up on the prequalification application. */
export default function PrequalificationBanner() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { summary, loaded, opening, error } = useAppSelector((s) => s.contractorApplication.portal);

  useEffect(() => {
    void dispatch(fetchPortalApplicationSummary());
  }, [dispatch]);

  if (!loaded || summary?.status === "approved" || summary?.status === "denied") return null;
  const status = summary?.status ?? "none";
  const overdue = !!summary?.due_at && new Date(summary.due_at).getTime() < Date.now();

  return (
    <section className={cn("cpq-banner", overdue && "is-overdue")} aria-live="polite">
      <ClipboardCheck size={22} aria-hidden className="cpq-banner-icon" />
      <div className="cpq-banner-copy">
        <p className="cpq-banner-title">{t(`cpq.banner.${status}.title`)}</p>
        <p className="cpq-banner-body">
          {t(`cpq.banner.${status}.body`)}
          {summary?.due_at && (status === "draft" || status === "needs_info")
            ? ` ${t(overdue ? "cpq.banner.overdue" : "cpq.banner.due", { date: fmt.date(summary.due_at) })}`
            : ""}
        </p>
        <ErrorNote error={error} />
      </div>
      <button
        type="button"
        className={cn("button button-gold", opening && "pf-btn--busy")}
        disabled={opening}
        onClick={async () => {
          const r = await dispatch(openPortalApplication());
          if (openPortalApplication.fulfilled.match(r)) navigate(r.payload);
        }}
      >
        {opening ? <Loader2 className="spin" size={16} aria-hidden /> : null}
        {t(status === "submitted" || status === "in_review" ? "cpq.banner.openDocs" : "cpq.banner.open")}
      </button>
    </section>
  );
}
