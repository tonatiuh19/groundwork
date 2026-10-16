import { useEffect, useState } from "react";
import { AlertTriangle, Globe, Monitor, PhoneForwarded, Plus, Trash2, Unplug, User, Users, Voicemail } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PhoneLineSettings, PhoneLineSettingsBody } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearPhoneLine, disconnectPhoneLine, fetchPhoneLine, savePhoneLine } from "@/store/slices/phoneLinesSlice";
import { fetchAdminPhoneNumbers } from "@/store/slices/conversationsSlice";
import { BusyButton, ErrorNote, Loading, Modal } from "@/components/portal/kit";

type Draft = PhoneLineSettingsBody;

const toDraft = (s: PhoneLineSettings): Draft => ({
  line_mode: s.line.line_mode,
  assigned_admin_id: s.line.assigned_admin_id,
  members: s.members.map((m) => ({ admin_id: m.admin_id, ring_browser: m.ring_browser })),
  ring_numbers: s.ring_numbers.map((r) => ({ label: r.label, e164: r.e164, is_active: r.is_active })),
  ring_timeout_sec: s.line.ring_timeout_sec,
  voicemail_greeting_en: s.line.voicemail_greeting_en,
  voicemail_greeting_es: s.line.voicemail_greeting_es,
});

/**
 * Phone line settings — the single source of truth for a brand line:
 * who sees it (members), what rings (browsers + screened phones), how long,
 * and the one bilingual voicemail every unanswered call hears.
 */
export default function PhoneLineSettingsModal({ lineId, onClose }: { lineId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { current, loading, saving, error } = useAppSelector((s) => s.phoneLines);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newRing, setNewRing] = useState({ label: "", e164: "" });
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (lineId == null) return;
    setDraft(null);
    void dispatch(fetchPhoneLine(lineId));
    return () => {
      dispatch(clearPhoneLine());
    };
  }, [dispatch, lineId]);
  useEffect(() => {
    if (current && current.line.id === lineId) setDraft(toDraft(current));
  }, [current, lineId]);

  const data = current && current.line.id === lineId ? current : null;
  const isMember = (id: number) => draft?.members.some((m) => m.admin_id === id) ?? false;
  const memberOf = (id: number) => draft?.members.find((m) => m.admin_id === id);
  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });
  const ringingBrowsers = draft ? draft.members.filter((m) => m.ring_browser).length : 0;
  const ringingPhones = draft ? draft.ring_numbers.filter((r) => r.is_active).length : 0;

  return (
    <Modal open={lineId != null} titleKey="phoneLine.title" onClose={onClose}>
      {!data || !draft ? (
        loading ? <Loading /> : <ErrorNote error={error} />
      ) : (
        <div className="pf-form gw-line-settings">
          <p className="gw-line-number">
            <strong>{data.line.e164}</strong>
            {data.line.friendly_name ? <span className="pf-muted"> · {data.line.friendly_name}</span> : null}
            {data.line.is_primary ? <span className="pf-badge pf-badge--good">{t("phoneLine.primary")}</span> : null}
          </p>

          {data.now.needs_owner ? (
            <p className="gw-line-alert" role="alert">
              <AlertTriangle size={15} aria-hidden /> {t("phoneLine.needsOwner")}
            </p>
          ) : null}

          <fieldset className="gw-line-mode">
            <legend>{t("phoneLine.mode")}</legend>
            {(["shared", "personal"] as const).map((m) => (
              <label key={m} className={`gw-line-mode__opt${draft.line_mode === m ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="line_mode"
                  checked={draft.line_mode === m}
                  onChange={() => set({ line_mode: m, members: m === "personal" ? [] : draft.members })}
                />
                {m === "shared" ? <Users size={16} aria-hidden /> : <User size={16} aria-hidden />}
                <span>
                  <strong>{t(`phoneLine.modeOpt.${m}`)}</strong>
                  <small>{t(`phoneLine.modeHint.${m}`)}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {/* Plain-language summary of what a caller gets */}
          <div className="gw-line-summary" role="status">
            <p>
              {draft.line_mode === "personal"
                ? t("phoneLine.summaryPersonal")
                : t("phoneLine.summary", {
                    browsers: ringingBrowsers,
                    phones: ringingPhones,
                    seconds: draft.ring_timeout_sec,
                  })}
            </p>
            <p className="pf-muted">{t("phoneLine.summaryNow", { count: data.now.ringing_browsers })}</p>
          </div>

          <ErrorNote error={error} />

          <label className="pf-field">
            <span>{t("phoneLine.owner")}</span>
            <select
              value={draft.assigned_admin_id ?? ""}
              onChange={(e) => set({ assigned_admin_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">{t("pf.none")}</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <small className="pf-hint">{t(draft.line_mode === "personal" ? "phoneLine.ownerHintPersonal" : "phoneLine.ownerHint")}</small>
          </label>

          {draft.line_mode === "shared" ? (
          <fieldset className="gw-line-members">
            <legend>{t("phoneLine.members")}</legend>
            <p className="pf-hint">{t("phoneLine.membersHint")}</p>
            {data.staff.map((s) => {
              const m = memberOf(s.id);
              return (
                <div key={s.id} className="gw-line-member">
                  <label className="gw-check">
                    <input
                      type="checkbox"
                      checked={isMember(s.id)}
                      onChange={(e) =>
                        set({
                          members: e.target.checked
                            ? [...draft.members, { admin_id: s.id, ring_browser: true }]
                            : draft.members.filter((x) => x.admin_id !== s.id),
                        })
                      }
                    />
                    <span>
                      {s.name} <span className="pf-muted">· {t(`role.${s.role}`, { defaultValue: s.role })}</span>
                    </span>
                  </label>
                  {m ? (
                    <label className="gw-check gw-line-ring-toggle">
                      <input
                        type="checkbox"
                        checked={m.ring_browser}
                        onChange={(e) =>
                          set({
                            members: draft.members.map((x) => (x.admin_id === s.id ? { ...x, ring_browser: e.target.checked } : x)),
                          })
                        }
                      />
                      <span><Monitor size={13} aria-hidden /> {t("phoneLine.ringBrowser")}</span>
                    </label>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          ) : (
            <p className="pf-hint gw-line-visibility">{t("phoneLine.personalVisibility")}</p>
          )}

          <fieldset className="gw-line-phones">
            <legend><PhoneForwarded size={14} aria-hidden /> {t("phoneLine.phones")}</legend>
            <p className="pf-hint">{t(draft.line_mode === "personal" ? "phoneLine.phonesHintPersonal" : "phoneLine.phonesHint")}</p>
            {draft.ring_numbers.map((r, i) => (
              <div key={`${r.e164}-${i}`} className="gw-line-phone">
                <label className="gw-check">
                  <input
                    type="checkbox"
                    checked={r.is_active}
                    onChange={(e) =>
                      set({ ring_numbers: draft.ring_numbers.map((x, j) => (j === i ? { ...x, is_active: e.target.checked } : x)) })
                    }
                  />
                  <span><strong>{r.label}</strong> <span className="pf-muted">{r.e164}</span></span>
                </label>
                <button
                  type="button"
                  className="pf-icon-btn pf-icon-btn--danger"
                  aria-label={t("phoneLine.removePhone")}
                  onClick={() => set({ ring_numbers: draft.ring_numbers.filter((_, j) => j !== i) })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {draft.ring_numbers.length < 5 ? (
              <div className="gw-line-add">
                <input
                  placeholder={t("phoneLine.phoneLabel")}
                  value={newRing.label}
                  maxLength={80}
                  onChange={(e) => setNewRing({ ...newRing, label: e.target.value })}
                />
                <input
                  placeholder="(555) 555-5555"
                  inputMode="tel"
                  value={newRing.e164}
                  onChange={(e) => setNewRing({ ...newRing, e164: e.target.value })}
                />
                <button
                  type="button"
                  className="pf-btn"
                  disabled={!newRing.label.trim() || newRing.e164.replace(/\D/g, "").length < 10}
                  onClick={() => {
                    set({ ring_numbers: [...draft.ring_numbers, { label: newRing.label.trim(), e164: newRing.e164, is_active: true }] });
                    setNewRing({ label: "", e164: "" });
                  }}
                >
                  <Plus size={14} aria-hidden /> {t("phoneLine.addPhone")}
                </button>
              </div>
            ) : null}
          </fieldset>

          <label className="pf-field">
            <span>{t("phoneLine.timeout")}</span>
            <select value={draft.ring_timeout_sec} onChange={(e) => set({ ring_timeout_sec: Number(e.target.value) })}>
              {[15, 20, 25, 30, 40].map((n) => (
                <option key={n} value={n}>{t("phoneLine.seconds", { count: n })}</option>
              ))}
            </select>
          </label>

          <fieldset className="gw-line-vm">
            <legend><Voicemail size={14} aria-hidden /> {t("phoneLine.voicemail")}</legend>
            <p className="pf-hint">{t("phoneLine.voicemailHint")}</p>
            <label className="pf-field">
              <span>{t("phoneLine.greetingEn")}</span>
              <textarea
                rows={3}
                maxLength={600}
                value={draft.voicemail_greeting_en ?? ""}
                placeholder={data.defaults.en}
                onChange={(e) => set({ voicemail_greeting_en: e.target.value || null })}
              />
            </label>
            <label className="pf-field">
              <span><Globe size={13} aria-hidden /> {t("phoneLine.greetingEs")}</span>
              <textarea
                rows={3}
                maxLength={600}
                value={draft.voicemail_greeting_es ?? ""}
                placeholder={data.defaults.es}
                onChange={(e) => set({ voicemail_greeting_es: e.target.value || null })}
              />
            </label>
          </fieldset>

          {!data.line.is_primary ? (
            <div className="gw-line-danger">
              {disconnecting ? (
                <>
                  <p className="pf-hint">{t("phoneLine.disconnectHelp", { number: data.line.e164 })}</p>
                  <div className="gw-line-add">
                    <input value={confirmText} placeholder={data.line.e164} onChange={(e) => setConfirmText(e.target.value)} />
                    <BusyButton
                      icon={Unplug}
                      label={t("phoneLine.disconnect")}
                      busy={saving}
                      disabled={confirmText.trim() !== data.line.e164}
                      onClick={async () => {
                        const r = await dispatch(disconnectPhoneLine({ id: data.line.id, confirm: confirmText.trim() }));
                        if (disconnectPhoneLine.fulfilled.match(r)) {
                          void dispatch(fetchAdminPhoneNumbers());
                          onClose();
                        }
                      }}
                    />
                  </div>
                </>
              ) : (
                <button type="button" className="text-link gw-line-danger__link" onClick={() => setDisconnecting(true)}>
                  <Unplug size={14} aria-hidden /> {t("phoneLine.disconnect")}
                </button>
              )}
            </div>
          ) : null}

          <div className="pf-actions">
            <button type="button" className="pf-btn" onClick={onClose}>{t("pf.cancel")}</button>
            <BusyButton
              tone="gold"
              className="pf-submit"
              label={t("pf.save")}
              busy={saving}
              disabled={draft.line_mode === "personal" && draft.assigned_admin_id == null}
              onClick={async () => {
                const r = await dispatch(
                  savePhoneLine({
                    id: data.line.id,
                    body: {
                      ...draft,
                      voicemail_greeting_en: draft.voicemail_greeting_en?.trim() || null,
                      voicemail_greeting_es: draft.voicemail_greeting_es?.trim() || null,
                    },
                  }),
                );
                if (savePhoneLine.fulfilled.match(r)) {
                  void dispatch(fetchAdminPhoneNumbers());
                  onClose();
                }
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
