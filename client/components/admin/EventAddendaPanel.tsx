import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FileSignature } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchEventAddenda } from "@/store/slices/addendaSlice";
import { StatusBadge } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

/**
 * Event page → Special agreements attached to this event: who earns what on its sign-ups. Agreements are
 * written on the affiliate's page (Special agreements → pick this event); this lists them with a link there.
 */
export default function EventAddendaPanel({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const list = useAppSelector((s) => s.addenda.byEvent[eventId]);
  useEffect(() => {
    void dispatch(fetchEventAddenda(eventId));
  }, [dispatch, eventId]);
  return (
    <section className="pf-section">
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <FileSignature size={17} aria-hidden /> {t("addendum.eventTitle")}
        </h2>
      </div>
      <p className="pf-hint">{t("addendum.eventLead")}</p>
      {list && !list.length ? <p className="pf-muted">{t("addendum.eventNone")}</p> : null}
      {list?.length ? (
        <ul className="gw-production__list">
          {list.map((a) => (
            <li key={a.id}>
              <span>
                <Link to={`/admin/affiliates/${a.affiliate_id}#addenda`}>
                  <strong>{a.affiliate_name}</strong>
                </Link>
                <small className="pf-muted"> · {a.title}</small>
              </span>
              <span>
                {fmt.money(a.rate_cents_per_sqft)} / {t("addendum.sqft")} · {t(`addendum.mode_${a.pay_mode}`)} <StatusBadge group="addendum.status" value={a.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
