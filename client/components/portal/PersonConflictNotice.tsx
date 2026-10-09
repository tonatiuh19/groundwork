import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BusyButton, StatusBadge } from "@/components/portal/kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearPersonConflict } from "@/store/slices/personConflictSlice";

const RECORD_PATH = { client: "clients", affiliate: "affiliates", contractor: "contractors" } as const;

/**
 * One role per person: shows who already owns this email / phone (with a link)
 * after a staff create / convert / save is refused. When only the phone matched,
 * staff can confirm "different person" with a reason → `onOverride(reason)`
 * resubmits with `shared_phone_reason` (audited server-side).
 */
export default function PersonConflictNotice({
  onOverride,
  busy,
}: {
  onOverride?: (reason: string) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const conflict = useAppSelector((s) => s.personConflict.current);
  const [reason, setReason] = useState("");

  useEffect(() => {
    setReason("");
  }, [conflict]);
  useEffect(
    () => () => {
      dispatch(clearPersonConflict());
    },
    [dispatch],
  );

  if (!conflict) return null;
  const m = conflict.match;
  return (
    <div className="person-conflict" role="alert">
      <UserX size={20} aria-hidden className="person-conflict-icon" />
      <div className="person-conflict-body">
        <p className="person-conflict-title">
          {t(m?.by === "phone" ? "personConflict.titlePhone" : "personConflict.titleEmail")}
        </p>
        {m ? (
          <p className="person-conflict-match">
            <span className="person-conflict-role">{t(`personConflict.role.${m.entity}`)}</span>
            <strong>{m.name}</strong>
            {m.email ? <span className="pf-muted"> · {m.email}</span> : null}
            {m.phone ? <span className="pf-muted"> · {m.phone}</span> : null}
            <StatusBadge group="accountStatus" value={m.status} />
            <Link className="text-link" to={`/admin/${RECORD_PATH[m.entity]}/${m.id}`}>
              <ExternalLink size={13} aria-hidden /> {t("personConflict.open")}
            </Link>
          </p>
        ) : null}
        <p className="pf-hint">{t("personConflict.oneRole")}</p>
        {conflict.canOverride && onOverride ? (
          <div className="person-conflict-override">
            <label className="pf-field">
              <span>{t("personConflict.overrideReason")}</span>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              <small className="pf-hint">{t("personConflict.overrideHint")}</small>
            </label>
            <BusyButton
              label={t("personConflict.overrideConfirm")}
              busy={busy}
              disabled={reason.trim().length < 5}
              onClick={() => onOverride(reason.trim())}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
