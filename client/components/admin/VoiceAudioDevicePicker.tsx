/**
 * Mic / speaker device pickers + live mic meter + volume slider.
 * Used in voice settings (pre-call) and the active call panel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, MicOff, Volume1, Volume2, VolumeX } from "lucide-react";
import type { Device } from "@twilio/voice-sdk";
import {
  applyTwilioInputDevice,
  applyTwilioSpeakerDevice,
  applyVolumeToAudioElements,
  deviceLabel,
  enumerateVoiceAudioDevices,
  persistMicId,
  persistSpeakerId,
  persistSpeakerVolume,
  readStoredMicId,
  readStoredSpeakerId,
  readStoredSpeakerVolume,
  supportsAudioOutputSelection,
  type TwilioAudioHelper,
} from "@/lib/voiceAudioDevices";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/cn";

type Props = {
  /** Twilio Device.audio when registered; optional for permission-only preview. */
  deviceAudio?: Device["audio"] | TwilioAudioHelper | null;
  /** Compact layout for in-call chrome. */
  compact?: boolean;
  className?: string;
};

export function VoiceAudioDevicePicker({
  deviceAudio,
  compact,
  className,
}: Props) {
  const { t } = useTranslation();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState(readStoredMicId);
  const [speakerId, setSpeakerId] = useState(readStoredSpeakerId);
  const [volume, setVolume] = useState(readStoredSpeakerVolume);
  const [micLevel, setMicLevel] = useState(0);
  const [permDenied, setPermDenied] = useState(false);
  const sinkSupported = supportsAudioOutputSelection();

  const micRafRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);

  const stopMicMeter = useCallback(() => {
    if (micRafRef.current != null) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micStreamRef.current = null;
    void micCtxRef.current?.close().catch(() => {});
    micCtxRef.current = null;
    setMicLevel(0);
  }, []);

  const startMicMeter = useCallback(
    async (deviceId: string) => {
      stopMicMeter();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio:
            deviceId && deviceId !== "default"
              ? {
                  deviceId: { exact: deviceId },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                }
              : {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
        });
        micStreamRef.current = stream;
        const ctx = new AudioContext();
        micCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const rms = Math.sqrt(
            data.reduce((s, v) => s + v * v, 0) / data.length,
          );
          setMicLevel(Math.min(100, Math.round((rms / 128) * 100)));
          micRafRef.current = requestAnimationFrame(tick);
        };
        micRafRef.current = requestAnimationFrame(tick);
        setPermDenied(false);
      } catch {
        setPermDenied(true);
      }
    },
    [stopMicMeter],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const lists = await enumerateVoiceAudioDevices();
      setMics(lists.mics);
      setSpeakers(lists.speakers);
    } catch (e) {
      logger.warn("voice", "enumerate devices failed", e);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshDevices();
      await startMicMeter(readStoredMicId());
      const audio = deviceAudio as TwilioAudioHelper | null | undefined;
      await applyTwilioInputDevice(audio, readStoredMicId()).catch(() => {});
      await applyTwilioSpeakerDevice(audio, readStoredSpeakerId()).catch(
        () => {},
      );
      applyVolumeToAudioElements(readStoredSpeakerVolume());
    })();
    const onChange = () => {
      void refreshDevices();
      const audio = deviceAudio as TwilioAudioHelper | null | undefined;
      void applyTwilioInputDevice(audio, readStoredMicId()).catch(() => {});
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      stopMicMeter();
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / deviceAudio identity
  }, [deviceAudio]);

  const onMicChange = async (next: string) => {
    setMicId(next);
    persistMicId(next);
    await startMicMeter(next);
    try {
      await applyTwilioInputDevice(
        deviceAudio as TwilioAudioHelper | null,
        next,
      );
    } catch (e) {
      logger.error("voice", "set input device failed", e);
    }
  };

  const onSpeakerChange = async (next: string) => {
    setSpeakerId(next);
    persistSpeakerId(next);
    try {
      await applyTwilioSpeakerDevice(
        deviceAudio as TwilioAudioHelper | null,
        next,
      );
    } catch (e) {
      logger.error("voice", "set speaker device failed", e);
    }
  };

  const onVolumeChange = (vol: number) => {
    setVolume(vol);
    persistSpeakerVolume(vol);
    applyVolumeToAudioElements(vol);
  };

  const VolumeIcon =
    volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      className={cn(
        "gw-voice-audio",
        compact && "gw-voice-audio--compact",
        className,
      )}
    >
      <div className="gw-voice-audio__field">
        <label className="gw-voice-audio__label" htmlFor="gw-voice-mic">
          <Mic className="w-3.5 h-3.5" aria-hidden />
          {t("conversations.audioMic")}
        </label>
        <select
          id="gw-voice-mic"
          className="pf-input w-full"
          value={micId}
          onChange={(e) => void onMicChange(e.target.value)}
        >
          <option value="default">{t("conversations.audioSystemDefault")}</option>
          {mics
            .filter((d) => d.deviceId && d.deviceId !== "default")
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {deviceLabel(d, t("conversations.audioMic"))}
              </option>
            ))}
        </select>
        <div className="gw-voice-audio__meter" aria-hidden>
          <p className="gw-voice-audio__meter-hint">
            {permDenied ? (
              <>
                <MicOff className="w-3 h-3" />
                {t("conversations.audioMicDenied")}
              </>
            ) : micLevel > 5 ? (
              <>
                <Mic className="w-3 h-3" />
                {t("conversations.audioMicActive")}
              </>
            ) : (
              <>
                <MicOff className="w-3 h-3" />
                {t("conversations.audioMicSpeak")}
              </>
            )}
          </p>
          <div className="gw-voice-audio__meter-track">
            <div
              className={cn(
                "gw-voice-audio__meter-fill",
                micLevel > 60 && "is-hot",
                micLevel > 20 && micLevel <= 60 && "is-mid",
              )}
              style={{ width: `${micLevel}%` }}
            />
          </div>
        </div>
      </div>

      <div className="gw-voice-audio__field">
        <label className="gw-voice-audio__label" htmlFor="gw-voice-speaker">
          <Volume2 className="w-3.5 h-3.5" aria-hidden />
          {t("conversations.audioSpeaker")}
        </label>
        {sinkSupported ? (
          <select
            id="gw-voice-speaker"
            className="pf-input w-full"
            value={speakerId}
            onChange={(e) => void onSpeakerChange(e.target.value)}
          >
            <option value="default">
              {t("conversations.audioSystemDefault")}
            </option>
            {speakers
              .filter((d) => d.deviceId && d.deviceId !== "default")
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {deviceLabel(d, t("conversations.audioSpeaker"))}
                </option>
              ))}
          </select>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("conversations.audioSpeakerUnsupported")}
          </p>
        )}
        <div className="gw-voice-audio__volume">
          <div className="gw-voice-audio__volume-row">
            <span className="gw-voice-audio__label">
              <VolumeIcon className="w-3 h-3" aria-hidden />
              {t("conversations.audioVolume")}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground">
              {Math.round(volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label={t("conversations.audioVolume")}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="gw-voice-audio__slider"
          />
          {volume > 0 && volume < 0.5 ? (
            <p className="text-xs text-amber-700">
              {t("conversations.audioVolumeLow")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
