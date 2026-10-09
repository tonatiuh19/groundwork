import { Mail, MessageSquare, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ADMIN_NOTIFY_EVENT_KEYS } from "@/lib/adminNotifyPrefs";
import { cn } from "@/lib/cn";
import type { AdminNotifyChannel, AdminNotifyEventKey } from "@shared/api";

export const NOTIFY_CHANNELS: {
  key: AdminNotifyChannel;
  icon: typeof Mail;
}[] = [
  { key: "email", icon: Mail },
  { key: "in_app", icon: MessageSquare },
  { key: "sms", icon: Smartphone },
];

export function EventTypeToggles(props: {
  checked: (key: AdminNotifyEventKey) => boolean;
  disabled?: boolean;
  onToggle: (key: AdminNotifyEventKey, value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="gw-notify-event-toggles">
      {ADMIN_NOTIFY_EVENT_KEYS.map((eventKey) => {
        const on = props.checked(eventKey);
        return (
          <button
            key={eventKey}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onToggle(eventKey, !on)}
            className={cn(
              "gw-notify-event-chip",
              on && "gw-notify-event-chip--on",
            )}
            aria-pressed={on}
          >
            {t(`admin.notifyEvents.${eventKey}`)}
          </button>
        );
      })}
    </div>
  );
}

export function ChannelSwitch(props: {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={cn("gw-notify-switch", props.disabled && "is-disabled")}>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="gw-notify-switch-ui" aria-hidden />
    </label>
  );
}

export function ChannelEventSections(props: {
  channels: AdminNotifyChannel[];
  disabled?: boolean;
  channelLocked?: (channel: AdminNotifyChannel) => boolean;
  checked: (
    channel: AdminNotifyChannel,
    key: AdminNotifyEventKey,
  ) => boolean;
  onToggle: (
    channel: AdminNotifyChannel,
    key: AdminNotifyEventKey,
    value: boolean,
  ) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="gw-notify-channel-sections">
      {props.channels.map((channel) => {
        const locked = props.channelLocked?.(channel) ?? false;
        return (
          <div key={channel} className="gw-notify-channel-section">
            <p className="gw-notify-channel-section-label">
              {t(`admin.notifyChannel.${channel}`)}
              {locked ? ` · ${t("admin.notifyChannelLocked")}` : ""}
            </p>
            <EventTypeToggles
              disabled={props.disabled || locked}
              checked={(k) => props.checked(channel, k)}
              onToggle={(k, v) => props.onToggle(channel, k, v)}
            />
          </div>
        );
      })}
    </div>
  );
}
