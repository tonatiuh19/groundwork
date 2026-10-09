import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/portal/Modal";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { VoiceAudioDevicePicker } from "@/components/admin/VoiceAudioDevicePicker";
import { useVoiceDeviceOptional } from "@/contexts/VoiceDeviceContext";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchVoiceCallForwarding,
  fetchVoicemailSettings,
  saveVoiceCallForwarding,
  saveVoicemailSettings,
  setVoiceAvailableLocal,
} from "@/store/slices/voiceSlice";

export function ConversationVoiceSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const voiceDevice = useVoiceDeviceOptional();
  const isAvailable = useAppSelector((s) => s.voice.isAvailable);
  const cf = useAppSelector((s) => s.voice.callForwarding);
  const vm = useAppSelector((s) => s.voice.voicemail);
  const [fwdEnabled, setFwdEnabled] = useState(false);
  const [fwdPhone, setFwdPhone] = useState("");
  const [vmEnabled, setVmEnabled] = useState<boolean | null>(null);
  const [vmGreeting, setVmGreeting] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deviceAudio = voiceDevice?.getDevice()?.audio ?? null;

  useEffect(() => {
    if (!open) return;
    void dispatch(fetchVoiceCallForwarding());
    void dispatch(fetchVoicemailSettings());
  }, [dispatch, open]);

  useEffect(() => {
    if (!open) return;
    setFwdEnabled(cf.enabled);
    setFwdPhone(cf.phone || "");
  }, [cf.enabled, cf.phone, open]);

  useEffect(() => {
    if (!open) return;
    setVmEnabled(vm.adminEnabled);
    setVmGreeting(vm.greetingText || vm.tenantGreeting || "");
  }, [open, vm.adminEnabled, vm.greetingText, vm.tenantGreeting]);

  return (
    <Modal open={open} titleKey="conversations.voiceSettingsTitle" onClose={onClose}>
      <div className="space-y-4 max-w-full">
        <p className="text-sm text-muted-foreground">
          {t("conversations.voiceSettingsLead")}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isAvailable}
            onChange={(e) => {
              // GlobalVoiceManager syncs Device register + /voice/availability.
              const next = e.target.checked;
              try {
                localStorage.setItem("gw.voice.available", String(next));
              } catch {
                /* ignore */
              }
              dispatch(setVoiceAvailableLocal(next));
            }}
          />
          {t("conversations.softphoneAvailable")}
        </label>

        {open ? (
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="text-sm font-semibold mb-1">
              {t("conversations.audioDevicesTitle")}
            </legend>
            <p className="text-xs text-muted-foreground">
              {t("conversations.audioDevicesLead")}
            </p>
            <VoiceAudioDevicePicker deviceAudio={deviceAudio} />
          </fieldset>
        ) : null}

        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend className="text-sm font-semibold mb-1">
            {t("conversations.callForwardingTitle")}
          </legend>
          <p className="text-xs text-muted-foreground">
            {t("conversations.callForwardingLead")}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fwdEnabled}
              onChange={(e) => setFwdEnabled(e.target.checked)}
            />
            {t("conversations.callForwardingEnabled")}
          </label>
          <input
            type="tel"
            className="pf-input w-full"
            value={fwdPhone}
            onChange={(e) => setFwdPhone(e.target.value)}
            placeholder={t("conversations.callForwardingPhone")}
            disabled={!fwdEnabled}
          />
        </fieldset>

        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend className="text-sm font-semibold mb-1">
            {t("conversations.voicemailTitle")}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={
                vmEnabled === null ? vm.tenantEnabled : !!vmEnabled
              }
              onChange={(e) => setVmEnabled(e.target.checked)}
            />
            {t("conversations.voicemailEnabled")}
          </label>
          <textarea
            className="pf-input w-full min-h-[5rem]"
            value={vmGreeting}
            onChange={(e) => setVmGreeting(e.target.value)}
            placeholder={t("conversations.voicemailGreeting")}
          />
        </fieldset>

        {error && <ErrorNote error={error} />}

        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" className="pf-btn" onClick={onClose}>
            {t("conversations.close")}
          </button>
          <BusyButton
            type="button"
            className="pf-btn pf-btn--primary"
            busy={cf.saving || vm.saving}
            label={t("conversations.saveSettings")}
            onClick={async () => {
              setError(null);
              try {
                await dispatch(
                  saveVoiceCallForwarding({
                    enabled: fwdEnabled,
                    phone: fwdPhone,
                  }),
                ).unwrap();
                await dispatch(
                  saveVoicemailSettings({
                    enabled: vmEnabled,
                    greeting_text: vmGreeting,
                  }),
                ).unwrap();
                onClose();
              } catch (e) {
                setError(typeof e === "string" ? e : "errors.server");
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
