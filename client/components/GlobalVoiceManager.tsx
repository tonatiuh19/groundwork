import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Device, type Call } from "@twilio/voice-sdk";
import { Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { VoiceDeviceProvider } from "@/contexts/VoiceDeviceContext";
import VoiceCallPanel from "@/components/VoiceCallPanel";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  endOutboundCall,
  fetchVoiceToken,
  lookupContactByPhone,
  setDeviceStatus,
  setVoiceAvailableLocal,
  updateVoiceAvailability,
} from "@/store/slices/voiceSlice";
import { logger } from "@/utils/logger";

/**
 * Mounts once in AdminLayout when conversations_enabled so the Twilio Device
 * (identity admin_{id}) stays alive across admin pages.
 *
 * Children (PortalShell / route pages) must sit inside VoiceDeviceProvider so
 * Conversations dialpad / Call buttons can call connectOutbound.
 *
 * Softphone registers only while staff is Available (Optimum parity).
 */
export default function GlobalVoiceManager({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.portalAuth.admin.user);
  const enabled = !!user?.conversations_enabled;
  const isAvailable = useAppSelector((s) => s.voice.isAvailable);
  const outboundCall = useAppSelector((s) => s.voice.outboundCall);

  const deviceRef = useRef<Device | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [ringingCall, setRingingCall] = useState<Call | null>(null);
  const [ringingPhone, setRingingPhone] = useState("");
  const [ringingClientName, setRingingClientName] = useState<string | null>(
    null,
  );
  const [activeIncomingCall, setActiveIncomingCall] = useState<Call | null>(
    null,
  );
  const [activeOutboundCall, setActiveOutboundCall] = useState<Call | null>(
    null,
  );
  const [deviceAudio, setDeviceAudio] = useState<Device["audio"] | null>(null);
  const busyRef = useRef(false);
  const seededAvailRef = useRef(false);

  const destroyDevice = useCallback(() => {
    setDeviceReady(false);
    try {
      deviceRef.current?.destroy();
    } catch {
      /* ignore */
    }
    deviceRef.current = null;
    setDeviceAudio(null);
    dispatch(setDeviceStatus("offline"));
  }, [dispatch]);

  const setupDevice = useCallback(async () => {
    if (!enabled || !user?.id) return;
    dispatch(setDeviceStatus("connecting"));
    try {
      const token = await dispatch(fetchVoiceToken()).unwrap();
      destroyDevice();
      const device = new Device(token, {
        logLevel: 1,
        codecPreferences: ["opus", "pcmu"] as any,
        allowIncomingWhileBusy: false,
        closeProtection: true,
      });
      deviceRef.current = device;
      setDeviceAudio(device.audio ?? null);

      const refreshToken = async () => {
        try {
          const next = await dispatch(fetchVoiceToken()).unwrap();
          await device.updateToken(next);
        } catch (e) {
          logger.error("voice", "token refresh failed", e);
        }
      };
      device.on("tokenWillExpire", () => {
        void refreshToken();
      });
      device.on("tokenExpired" as any, () => {
        void refreshToken();
      });

      device.on("registered", () => {
        dispatch(setDeviceStatus("ready"));
      });
      device.on("unregistered", () => {
        dispatch(setDeviceStatus("offline"));
      });
      device.on("error", (err) => {
        logger.error("voice", "device error", err);
        dispatch(setDeviceStatus("error"));
      });
      device.on("incoming", (call) => {
        if (busyRef.current || deviceRef.current?.isBusy) {
          try {
            call.reject();
          } catch {
            /* ignore */
          }
          return;
        }
        busyRef.current = true;
        const from =
          String(call.parameters?.From || call.parameters?.Caller || "").trim() ||
          t("conversations.unknownCaller");
        setRingingCall(call);
        setRingingPhone(from);
        void dispatch(lookupContactByPhone(from))
          .unwrap()
          .then((r) => {
            if (r.found) setRingingClientName(r.client_name || null);
          })
          .catch(() => {});
        call.on("cancel", () => {
          busyRef.current = false;
          setRingingCall(null);
          setRingingPhone("");
          setRingingClientName(null);
        });
        call.on("disconnect", () => {
          busyRef.current = false;
          setRingingCall(null);
          setActiveIncomingCall(null);
        });
        call.on("reject", () => {
          busyRef.current = false;
        });
      });

      // Register/unregister is owned by the isAvailable effect once deviceReady.
      setDeviceReady(true);
      if (!isAvailable) {
        dispatch(setDeviceStatus("offline"));
      }
    } catch (e) {
      logger.error("voice", "setup failed", e);
      dispatch(setDeviceStatus("error"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destroyDevice, dispatch, enabled, t, user?.id]);

  // Default Active every session (product default). Staff can still go Inactive
  // via the header toggle; that persists until they toggle back.
  useLayoutEffect(() => {
    if (!enabled || !user?.id || seededAvailRef.current) return;
    seededAvailRef.current = true;
    let prefer = true;
    try {
      const stored = localStorage.getItem("gw.voice.available");
      // Only honor an explicit Inactive choice; otherwise default Active.
      if (stored === "false") prefer = false;
    } catch {
      prefer = true;
    }
    dispatch(setVoiceAvailableLocal(prefer));
  }, [dispatch, enabled, user?.id]);

  useEffect(() => {
    if (!enabled) {
      destroyDevice();
      return;
    }
    void setupDevice();
    return () => {
      // Unregister locally only — do NOT persist Unavailable on unmount/HMR
      // (that was forcing staff back to UNAVAILABLE on every refresh).
      try {
        deviceRef.current?.unregister();
      } catch {
        /* ignore */
      }
      destroyDevice();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per enable
  }, [enabled, user?.id]);

  // Optimum parity: register softphone only while Available.
  useEffect(() => {
    if (!deviceReady || !deviceRef.current || !seededAvailRef.current) return;
    const device = deviceRef.current;
    if (isAvailable) {
      dispatch(setDeviceStatus("connecting"));
      device.register().catch((err) => {
        logger.error("voice", "register on available failed", err);
        dispatch(setDeviceStatus("error"));
      });
      void dispatch(updateVoiceAvailability(true));
    } else {
      device.unregister().catch(() => {});
      setRingingCall((current) => {
        if (current) {
          try {
            current.reject();
          } catch {
            /* ignore */
          }
        }
        return null;
      });
      busyRef.current = false;
      setRingingPhone("");
      setRingingClientName(null);
      dispatch(setDeviceStatus("offline"));
      void dispatch(updateVoiceAvailability(false));
    }
  }, [isAvailable, deviceReady, dispatch]);

  if (!enabled) {
    return <>{children}</>;
  }

  const panelCall = activeIncomingCall || activeOutboundCall;

  return (
    <VoiceDeviceProvider
      deviceRef={deviceRef}
      onActiveCallChange={(call) => {
        if (call && !activeIncomingCall) {
          busyRef.current = true;
          setActiveOutboundCall(call);
        }
        if (!call) {
          if (!ringingCall && !activeIncomingCall) busyRef.current = false;
          setActiveOutboundCall(null);
        }
      }}
    >
      {children}
      {ringingCall && (
        <div className="gw-voice-incoming" role="dialog" aria-live="assertive">
          <div className="gw-voice-incoming__card">
            <PhoneIncoming className="w-5 h-5 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">
                {ringingClientName || ringingPhone}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {t("conversations.incomingCall")}
              </p>
            </div>
            <button
              type="button"
              className="pf-btn pf-btn--primary"
              onClick={() => {
                ringingCall.accept({
                  rtcConstraints: {
                    audio: {
                      echoCancellation: true,
                      noiseSuppression: true,
                      autoGainControl: true,
                    },
                  },
                } as any);
                setActiveIncomingCall(ringingCall);
                setRingingCall(null);
              }}
            >
              <Phone className="w-4 h-4" />
              {t("conversations.answer")}
            </button>
            <button
              type="button"
              className="pf-btn"
              onClick={() => {
                ringingCall.reject();
                busyRef.current = false;
                setRingingCall(null);
              }}
            >
              <PhoneOff className="w-4 h-4" />
              {t("conversations.decline")}
            </button>
          </div>
        </div>
      )}
      {(outboundCall || panelCall) && (
        <VoiceCallPanel
          call={panelCall}
          deviceAudio={deviceAudio}
          onHangup={() => {
            try {
              panelCall?.disconnect();
            } catch {
              /* ignore */
            }
            busyRef.current = false;
            setActiveIncomingCall(null);
            setActiveOutboundCall(null);
            dispatch(endOutboundCall());
          }}
        />
      )}
    </VoiceDeviceProvider>
  );
}
