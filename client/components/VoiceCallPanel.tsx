import { useEffect, useRef, useState } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import {
  ChevronDown,
  ChevronUp,
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { VoiceAudioDevicePicker } from "@/components/admin/VoiceAudioDevicePicker";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { endOutboundCall, logVoiceCall } from "@/store/slices/voiceSlice";
import {
  applyVolumeToAudioElements,
  readStoredSpeakerVolume,
} from "@/lib/voiceAudioDevices";
import { logger } from "@/utils/logger";

type Props = {
  call?: Call | null;
  deviceAudio?: Device["audio"] | null;
  onHangup: () => void;
};

function resolveCallSid(call: Call | null | undefined): string | undefined {
  if (!call) return undefined;
  const params = call.parameters || {};
  const sid =
    params.CallSid ||
    params.CallSid?.toString?.() ||
    (call as { outboundConnectionId?: string }).outboundConnectionId;
  return sid ? String(sid) : undefined;
}

/**
 * Active call chrome: mute / speaker mute / hangup + expandable mic/speaker picker.
 */
export default function VoiceCallPanel({ call, deviceAudio, onHangup }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const outbound = useAppSelector((s) => s.voice.outboundCall);
  const [muted, setMuted] = useState(false);
  const [speakerOff, setSpeakerOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [activeCall, setActiveCall] = useState<Call | null>(call || null);
  const [showDevices, setShowDevices] = useState(false);

  const elapsedRef = useRef(0);
  const callSidRef = useRef<string | undefined>(undefined);
  const loggedRef = useRef(false);
  const outboundRef = useRef(outbound);
  outboundRef.current = outbound;
  const onHangupRef = useRef(onHangup);
  onHangupRef.current = onHangup;

  useEffect(() => {
    setActiveCall(call || null);
    loggedRef.current = false;
    const sid = resolveCallSid(call);
    if (sid) callSidRef.current = sid;
  }, [call]);

  useEffect(() => {
    if (!outbound?.startedAt && !activeCall) return;
    const start = outbound?.startedAt || Date.now();
    const tick = window.setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000);
      elapsedRef.current = sec;
      setElapsed(sec);
      const sid = resolveCallSid(activeCall);
      if (sid) callSidRef.current = sid;
    }, 1000);
    return () => window.clearInterval(tick);
  }, [outbound?.startedAt, activeCall]);

  useEffect(() => {
    if (!activeCall) return;
    const onDisconnect = () => {
      if (loggedRef.current) {
        onHangupRef.current();
        return;
      }
      loggedRef.current = true;
      const ob = outboundRef.current;
      const phone =
        ob?.phone ||
        String(
          activeCall.parameters?.From || activeCall.parameters?.To || "",
        );
      const sid = callSidRef.current || resolveCallSid(activeCall);
      void dispatch(
        logVoiceCall({
          phone,
          duration: elapsedRef.current,
          call_status: "completed",
          call_sid: sid,
          client_id: ob?.clientId ?? undefined,
          direction: ob ? "outbound" : "inbound",
        }),
      );
      dispatch(endOutboundCall());
      onHangupRef.current();
    };
    const onAccept = () => {
      const sid = resolveCallSid(activeCall);
      if (sid) callSidRef.current = sid;
      applyVolumeToAudioElements(readStoredSpeakerVolume());
    };
    activeCall.on("disconnect", onDisconnect);
    activeCall.on("accept", onAccept);
    // Already accepted outbound may fire accept before listener.
    applyVolumeToAudioElements(readStoredSpeakerVolume());
    return () => {
      activeCall.removeListener("disconnect", onDisconnect);
      activeCall.removeListener("accept", onAccept);
    };
  }, [activeCall, dispatch]);

  const title =
    outbound?.clientName ||
    outbound?.phone ||
    String(activeCall?.parameters?.From || t("conversations.voiceCall"));

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div
      className="gw-voice-panel"
      role="region"
      aria-label={t("conversations.voiceCall")}
    >
      <div className="gw-voice-panel__inner">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{title}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {mm}:{ss}
          </p>
        </div>
        <button
          type="button"
          className="pf-icon-btn"
          aria-pressed={muted}
          aria-label={t(muted ? "conversations.unmute" : "conversations.mute")}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            try {
              activeCall?.mute(next);
            } catch (e) {
              logger.warn("voice", "mute failed", e);
            }
          }}
        >
          {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button
          type="button"
          className="pf-icon-btn"
          aria-pressed={speakerOff}
          aria-label={t(
            speakerOff ? "conversations.speakerOn" : "conversations.speakerOff",
          )}
          onClick={() => {
            const next = !speakerOff;
            setSpeakerOff(next);
            try {
              document.querySelectorAll("audio").forEach((el) => {
                el.muted = next;
              });
              if (!next) {
                applyVolumeToAudioElements(readStoredSpeakerVolume());
              }
            } catch (e) {
              logger.warn("voice", "speaker mute failed", e);
            }
          }}
        >
          {speakerOff ? (
            <VolumeX className="w-4 h-4" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          className="pf-icon-btn"
          aria-expanded={showDevices}
          aria-label={t("conversations.audioDevicesToggle")}
          onClick={() => setShowDevices((v) => !v)}
        >
          {showDevices ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          className="pf-btn pf-btn--destructive"
          onClick={() => {
            try {
              activeCall?.disconnect();
            } catch {
              /* ignore */
            }
            if (!loggedRef.current) {
              loggedRef.current = true;
              const ob = outboundRef.current;
              void dispatch(
                logVoiceCall({
                  phone: ob?.phone || "",
                  duration: elapsedRef.current,
                  call_status: "completed",
                  call_sid: callSidRef.current || resolveCallSid(activeCall),
                  client_id: ob?.clientId ?? undefined,
                  direction: ob ? "outbound" : "inbound",
                }),
              );
            }
            onHangup();
            dispatch(endOutboundCall());
          }}
        >
          <PhoneOff className="w-4 h-4" />
          {t("conversations.hangup")}
        </button>
      </div>
      {showDevices ? (
        <div className="gw-voice-panel__devices">
          <VoiceAudioDevicePicker deviceAudio={deviceAudio} compact />
        </div>
      ) : null}
    </div>
  );
}
