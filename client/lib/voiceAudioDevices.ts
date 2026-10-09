/**
 * Softphone audio device helpers (mic / speaker / volume).
 * Preferences persist in localStorage so dialpad + settings + in-call stay aligned.
 */

export const VOICE_MIC_STORAGE_KEY = "gw.voice.mic_device_id";
export const VOICE_SPEAKER_STORAGE_KEY = "gw.voice.speaker_device_id";
export const VOICE_VOLUME_STORAGE_KEY = "gw.voice.speaker_volume";

export type VoiceAudioDeviceLists = {
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

export function supportsAudioOutputSelection(): boolean {
  if (typeof HTMLMediaElement === "undefined") return false;
  return typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId ===
    "function";
}

export function readStoredMicId(): string {
  try {
    return localStorage.getItem(VOICE_MIC_STORAGE_KEY) || "default";
  } catch {
    return "default";
  }
}

export function readStoredSpeakerId(): string {
  try {
    return localStorage.getItem(VOICE_SPEAKER_STORAGE_KEY) || "default";
  } catch {
    return "default";
  }
}

export function readStoredSpeakerVolume(): number {
  try {
    const raw = localStorage.getItem(VOICE_VOLUME_STORAGE_KEY);
    if (raw == null) return 1;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.min(1, Math.max(0, n));
  } catch {
    return 1;
  }
}

export function persistMicId(deviceId: string): void {
  try {
    localStorage.setItem(VOICE_MIC_STORAGE_KEY, deviceId || "default");
  } catch {
    /* ignore */
  }
}

export function persistSpeakerId(deviceId: string): void {
  try {
    localStorage.setItem(VOICE_SPEAKER_STORAGE_KEY, deviceId || "default");
  } catch {
    /* ignore */
  }
}

export function persistSpeakerVolume(vol: number): void {
  try {
    localStorage.setItem(
      VOICE_VOLUME_STORAGE_KEY,
      String(Math.min(1, Math.max(0, vol))),
    );
  } catch {
    /* ignore */
  }
}

export function applyVolumeToAudioElements(vol: number): void {
  if (typeof document === "undefined") return;
  const clamped = Math.min(1, Math.max(0, vol));
  document.querySelectorAll("audio").forEach((el) => {
    try {
      (el as HTMLAudioElement).volume = clamped;
      (el as HTMLAudioElement).muted = clamped === 0;
    } catch {
      /* ignore */
    }
  });
}

/** Request mic permission then list input/output devices with labels when allowed. */
export async function enumerateVoiceAudioDevices(): Promise<VoiceAudioDeviceLists> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return { mics: [], speakers: [] };
  }
  try {
    // Permission unlocks human-readable labels.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* labels may be empty; still enumerate */
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: devices.filter((d) => d.kind === "audioinput"),
    speakers: devices.filter((d) => d.kind === "audiooutput"),
  };
}

export function deviceLabel(
  device: MediaDeviceInfo,
  fallbackPrefix: string,
): string {
  const label = String(device.label || "").trim();
  if (label) return label;
  const id = String(device.deviceId || "").slice(0, 8);
  return id ? `${fallbackPrefix} ${id}` : fallbackPrefix;
}

/** Twilio Device.audio-shaped helper (subset we use). */
export type TwilioAudioHelper = {
  setInputDevice?: (deviceId: string) => Promise<void>;
  unsetInputDevice?: () => Promise<void>;
  speakerDevices?: {
    set: (deviceIds: string | string[]) => Promise<void>;
  };
};

export async function applyTwilioInputDevice(
  audio: TwilioAudioHelper | null | undefined,
  deviceId: string,
): Promise<void> {
  if (!audio?.setInputDevice) return;
  const id = deviceId || "default";
  if (id === "default") {
    if (audio.unsetInputDevice) {
      await audio.unsetInputDevice().catch(() => {});
    }
    return;
  }
  await audio.setInputDevice(id);
}

export async function applyTwilioSpeakerDevice(
  audio: TwilioAudioHelper | null | undefined,
  deviceId: string,
): Promise<void> {
  if (!audio?.speakerDevices?.set) return;
  const id = deviceId || "default";
  await audio.speakerDevices.set(id === "default" ? ["default"] : [id]);
}

export async function applyStoredTwilioAudioDevices(
  audio: TwilioAudioHelper | null | undefined,
): Promise<void> {
  if (!audio) return;
  await applyTwilioInputDevice(audio, readStoredMicId()).catch(() => {});
  await applyTwilioSpeakerDevice(audio, readStoredSpeakerId()).catch(() => {});
  applyVolumeToAudioElements(readStoredSpeakerVolume());
}
