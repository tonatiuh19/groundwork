/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VOICE_MIC_STORAGE_KEY,
  VOICE_SPEAKER_STORAGE_KEY,
  VOICE_VOLUME_STORAGE_KEY,
  applyTwilioInputDevice,
  applyTwilioSpeakerDevice,
  applyVolumeToAudioElements,
  deviceLabel,
  persistMicId,
  persistSpeakerId,
  persistSpeakerVolume,
  readStoredMicId,
  readStoredSpeakerId,
  readStoredSpeakerVolume,
  supportsAudioOutputSelection,
} from "./voiceAudioDevices";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("voiceAudioDevices storage", () => {
  it("defaults mic/speaker to default and volume to 1", () => {
    expect(readStoredMicId()).toBe("default");
    expect(readStoredSpeakerId()).toBe("default");
    expect(readStoredSpeakerVolume()).toBe(1);
  });

  it("persists and clamps volume", () => {
    persistSpeakerVolume(1.5);
    expect(localStorage.getItem(VOICE_VOLUME_STORAGE_KEY)).toBe("1");
    expect(readStoredSpeakerVolume()).toBe(1);
    persistSpeakerVolume(-0.2);
    expect(readStoredSpeakerVolume()).toBe(0);
    persistSpeakerVolume(0.45);
    expect(readStoredSpeakerVolume()).toBe(0.45);
  });

  it("persists mic and speaker ids", () => {
    persistMicId("mic-abc");
    persistSpeakerId("spk-xyz");
    expect(localStorage.getItem(VOICE_MIC_STORAGE_KEY)).toBe("mic-abc");
    expect(localStorage.getItem(VOICE_SPEAKER_STORAGE_KEY)).toBe("spk-xyz");
    expect(readStoredMicId()).toBe("mic-abc");
    expect(readStoredSpeakerId()).toBe("spk-xyz");
  });

  it("treats empty persist as default", () => {
    persistMicId("");
    expect(readStoredMicId()).toBe("default");
  });
});

describe("voiceAudioDevices helpers", () => {
  it("deviceLabel falls back when label empty", () => {
    expect(
      deviceLabel(
        { deviceId: "abcdef0123", label: "", kind: "audioinput" } as MediaDeviceInfo,
        "Mic",
      ),
    ).toBe("Mic abcdef01");
    expect(
      deviceLabel(
        { deviceId: "x", label: "Built-in", kind: "audioinput" } as MediaDeviceInfo,
        "Mic",
      ),
    ).toBe("Built-in");
  });

  it("applyVolumeToAudioElements sets volume and mutes at 0", () => {
    const a = document.createElement("audio");
    const b = document.createElement("audio");
    document.body.append(a, b);
    applyVolumeToAudioElements(0.3);
    expect(a.volume).toBeCloseTo(0.3);
    expect(a.muted).toBe(false);
    applyVolumeToAudioElements(0);
    expect(a.muted).toBe(true);
    expect(b.muted).toBe(true);
    a.remove();
    b.remove();
  });

  it("applyTwilioInputDevice uses unset for default", async () => {
    const setInputDevice = vi.fn().mockResolvedValue(undefined);
    const unsetInputDevice = vi.fn().mockResolvedValue(undefined);
    await applyTwilioInputDevice({ setInputDevice, unsetInputDevice }, "default");
    expect(unsetInputDevice).toHaveBeenCalled();
    expect(setInputDevice).not.toHaveBeenCalled();
    await applyTwilioInputDevice({ setInputDevice, unsetInputDevice }, "dev1");
    expect(setInputDevice).toHaveBeenCalledWith("dev1");
  });

  it("applyTwilioSpeakerDevice wraps device id array", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    await applyTwilioSpeakerDevice({ speakerDevices: { set } }, "spk1");
    expect(set).toHaveBeenCalledWith(["spk1"]);
    await applyTwilioSpeakerDevice({ speakerDevices: { set } }, "default");
    expect(set).toHaveBeenCalledWith(["default"]);
  });

  it("supportsAudioOutputSelection reflects setSinkId", () => {
    const proto = HTMLMediaElement.prototype as { setSinkId?: unknown };
    const prev = proto.setSinkId;
    delete proto.setSinkId;
    expect(supportsAudioOutputSelection()).toBe(false);
    proto.setSinkId = async () => {};
    expect(supportsAudioOutputSelection()).toBe(true);
    if (prev) proto.setSinkId = prev;
    else delete proto.setSinkId;
  });
});
