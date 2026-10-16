import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import { resolveEventQr } from "@/store/slices/publicEventsSlice";
import { rememberQrScan } from "@/lib/eventQr";
import PageMeta from "@/components/PageMeta";

/**
 * `/e/:slug` — target of printed event QR codes. Counts the scan, then lands on
 * the event RSVP (or the next open event once it is over; else its highlights).
 */
export default function EventQrRedirect() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    void dispatch(resolveEventQr(slug)).then((r) => {
      if (!alive) return;
      if (resolveEventQr.fulfilled.match(r) && r.payload.slug) {
        if (r.payload.event_id) rememberQrScan(r.payload.event_id);
        navigate(`/events/${r.payload.slug}${r.payload.register ? "#register" : ""}`, { replace: true });
      } else {
        navigate(resolveEventQr.fulfilled.match(r) ? "/events" : `/events/${slug}`, { replace: true });
      }
    });
    return () => {
      alive = false;
    };
  }, [dispatch, navigate, slug]);

  return (
    <div className="groundwork-page">
      <PageMeta title={t("events.title")} description={t("events.metaDescription")} noIndex />
      <main className="interior-main">
        <p className="pf-loading event-loading">
          <Loader2 className="spin" size={16} /> {t("pf.loading")}
        </p>
      </main>
    </div>
  );
}
