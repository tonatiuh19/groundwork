import { useEffect, useState } from "react";
import { AlertTriangle, Link2, User, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AvailableTwilioNumber, PhoneLineMode } from "@shared/api";
import { useAppDispatch } from "@/store/hooks";
import { connectTwilioNumber, fetchAvailableTwilioNumbers } from "@/store/slices/phoneLinesSlice";
import { fetchAdminPhoneNumbers } from "@/store/slices/conversationsSlice";
import { BusyButton, ErrorNote, Loading, Modal } from "@/components/portal/kit";

/**
 * Connect a number already bought in Twilio: pick it, choose personal (one
 * staff owner) or shared, and Groundwork sets its webhooks. Numbers answered
 * by another app (e.g. Encore) need an explicit "take over" confirmation.
 */
export default function ConnectTwilioNumberModal({
  open,
  onClose,
  staff,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  staff: { id: number; name: string }[];
  onConnected: (lineId: number) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [numbers, setNumbers] = useState<AvailableTwilioNumber[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sid, setSid] = useState("");
  const [mode, setMode] = useState<PhoneLineMode>("personal");
  const [owner, setOwner] = useState("");
  const [takeOver, setTakeOver] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNumbers(null);
    setError(null);
    setSid("");
    setTakeOver(false);
    void dispatch(fetchAvailableTwilioNumbers()).then((r) => {
      if (fetchAvailableTwilioNumbers.fulfilled.match(r)) setNumbers(r.payload);
      else setError(r.payload || "errors.server");
    });
  }, [dispatch, open]);

  const picked = numbers?.find((n) => n.sid === sid) || null;
  const ready = Boolean(picked) && (mode === "shared" || owner) && (!picked?.in_use_elsewhere || takeOver);

  return (
    <Modal open={open} titleKey="phoneLine.connectTitle" onClose={onClose}>
      <div className="pf-form">
        <p className="pf-hint">{t("phoneLine.connectHelp")}</p>
        <ErrorNote error={error} />
        {numbers == null && !error ? <Loading /> : null}
        {numbers && numbers.length === 0 ? <p className="pf-muted">{t("phoneLine.connectNone")}</p> : null}
        {numbers && numbers.length > 0 ? (
          <>
            <ul className="gw-connect-list" role="radiogroup">
              {numbers.map((n) => (
                <li key={n.sid}>
                  <label className={`gw-connect-item${sid === n.sid ? " is-active" : ""}`}>
                    <input type="radio" name="sid" checked={sid === n.sid} onChange={() => { setSid(n.sid); setTakeOver(false); }} />
                    <span>
                      <strong>{n.e164}</strong>
                      {n.friendly_name ? <span className="pf-muted"> · {n.friendly_name}</span> : null}
                      <small className={n.in_use_elsewhere ? "gw-connect-warn" : "pf-muted"}>
                        {n.in_use_elsewhere ? t("phoneLine.inUseElsewhere", { host: n.current_host || "?" }) : t("phoneLine.notConnected")}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <fieldset className="gw-line-mode">
              <legend>{t("phoneLine.mode")}</legend>
              {(["personal", "shared"] as const).map((m) => (
                <label key={m} className={`gw-line-mode__opt${mode === m ? " is-active" : ""}`}>
                  <input type="radio" name="connect_mode" checked={mode === m} onChange={() => setMode(m)} />
                  {m === "shared" ? <Users size={16} aria-hidden /> : <User size={16} aria-hidden />}
                  <span>
                    <strong>{t(`phoneLine.modeOpt.${m}`)}</strong>
                    <small>{t(`phoneLine.modeHint.${m}`)}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="pf-field">
              <span>{t(mode === "personal" ? "phoneLine.ownerPersonal" : "phoneLine.owner")}</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">{mode === "personal" ? t("phoneLine.pickStaff") : t("pf.none")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            {picked?.in_use_elsewhere ? (
              <label className="gw-check gw-connect-takeover">
                <input type="checkbox" checked={takeOver} onChange={(e) => setTakeOver(e.target.checked)} />
                <span>
                  <AlertTriangle size={14} aria-hidden /> {t("phoneLine.takeOver", { host: picked.current_host || "?" })}
                </span>
              </label>
            ) : null}
            <p className="pf-hint">{t("phoneLine.a2pNote")}</p>
          </>
        ) : null}
        <div className="pf-actions">
          <button type="button" className="pf-btn" onClick={onClose}>{t("pf.cancel")}</button>
          <BusyButton
            tone="gold"
            className="pf-submit"
            icon={Link2}
            label={t("phoneLine.connect")}
            busy={busy}
            disabled={!ready}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await dispatch(
                connectTwilioNumber({ sid, line_mode: mode, assigned_admin_id: owner ? Number(owner) : null, take_over: takeOver }),
              );
              setBusy(false);
              if (connectTwilioNumber.fulfilled.match(r)) {
                void dispatch(fetchAdminPhoneNumbers());
                onConnected(r.payload.line.id);
              } else {
                setError(r.payload || "errors.server");
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
