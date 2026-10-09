import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import { applyStoredTwilioAudioDevices } from "@/lib/voiceAudioDevices";

type VoiceDeviceContextValue = {
  getDevice: () => Device | null;
  waitForDevice: (timeoutMs?: number) => Promise<Device | null>;
  /** Connect outbound and register the Call so VoiceCallPanel can mute/hangup. */
  connectOutbound: (params: {
    To: string;
  }) => Promise<Call | null>;
  getActiveCall: () => Call | null;
  setActiveCall: (call: Call | null) => void;
};

const VoiceDeviceContext = createContext<VoiceDeviceContextValue | null>(null);

export function VoiceDeviceProvider({
  children,
  deviceRef,
  onActiveCallChange,
}: {
  children: React.ReactNode;
  deviceRef: React.RefObject<Device | null>;
  onActiveCallChange?: (call: Call | null) => void;
}) {
  const activeCallRef = useRef<Call | null>(null);

  const setActiveCall = useCallback(
    (call: Call | null) => {
      activeCallRef.current = call;
      onActiveCallChange?.(call);
    },
    [onActiveCallChange],
  );

  const waitForDevice = useCallback(
    async (timeoutMs = 15000): Promise<Device | null> => {
      const existing = deviceRef.current;
      if (existing) return existing;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 100));
        if (deviceRef.current) return deviceRef.current;
      }
      return null;
    },
    [deviceRef],
  );

  const getDevice = useCallback(() => deviceRef.current, [deviceRef]);
  const getActiveCall = useCallback(() => activeCallRef.current, []);

  const connectOutbound = useCallback(
    async (params: { To: string }): Promise<Call | null> => {
      const device = await waitForDevice(8000);
      if (!device) return null;
      // Apply mic/speaker prefs before connect so the first RTP uses them.
      await applyStoredTwilioAudioDevices(device.audio ?? null);
      const call = await device.connect({ params });
      setActiveCall(call);
      call.on("accept", () => {
        void applyStoredTwilioAudioDevices(device.audio ?? null);
      });
      call.on("disconnect", () => {
        if (activeCallRef.current === call) setActiveCall(null);
      });
      return call;
    },
    [setActiveCall, waitForDevice],
  );

  const value = useMemo(
    () => ({
      getDevice,
      waitForDevice,
      connectOutbound,
      getActiveCall,
      setActiveCall,
    }),
    [getDevice, waitForDevice, connectOutbound, getActiveCall, setActiveCall],
  );

  return (
    <VoiceDeviceContext.Provider value={value}>
      {children}
    </VoiceDeviceContext.Provider>
  );
}

export function useVoiceDevice(): VoiceDeviceContextValue {
  const ctx = useContext(VoiceDeviceContext);
  if (!ctx) {
    throw new Error("useVoiceDevice must be used within VoiceDeviceProvider");
  }
  return ctx;
}

export function useVoiceDeviceOptional(): VoiceDeviceContextValue | null {
  return useContext(VoiceDeviceContext);
}
