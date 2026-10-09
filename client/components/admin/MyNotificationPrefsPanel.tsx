import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchMyNotifyPrefs,
  updateMyNotifyPrefs,
} from "@/store/slices/adminNotificationsSlice";
import {
  adminNotifyChannelMasterOn,
} from "@/lib/adminNotifyPrefs";
import type { AdminNotifyChannel, AdminNotifyEventKey } from "@shared/api";
import { ErrorNote } from "@/components/portal/kit";
import {
  ChannelEventSections,
  ChannelSwitch,
  NOTIFY_CHANNELS,
} from "@/components/admin/AdminNotifyPrefsControls";
import { cn } from "@/lib/cn";

type Props = { className?: string };

export default function MyNotificationPrefsPanel({ className }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    prefs,
    channels,
    prefsLoading,
    prefsSaving,
    prefsError,
  } = useAppSelector((s) => s.adminNotifications);
  const [typesOpen, setTypesOpen] = useState(false);

  useEffect(() => {
    void dispatch(fetchMyNotifyPrefs());
  }, [dispatch]);

  if (prefsLoading && !prefs) {
    return (
      <section className={cn("pf-card", className)}>
        <p className="pf-muted">{t("pf.loading")}</p>
      </section>
    );
  }

  if (!prefs) {
    return (
      <section className={cn("pf-card", className)}>
        <ErrorNote error={prefsError} />
      </section>
    );
  }

  const toggleChannel = (channel: AdminNotifyChannel, value: boolean) => {
    if (channels?.[channel] && !channels[channel].available) return;
    void dispatch(
      updateMyNotifyPrefs({ channel_masters: { [channel]: value } }),
    );
  };

  const toggleEvent = (
    channel: AdminNotifyChannel,
    eventKey: AdminNotifyEventKey,
    value: boolean,
  ) => {
    if (channels?.[channel] && !channels[channel].available) return;
    void dispatch(
      updateMyNotifyPrefs({ [channel]: { [eventKey]: value } }),
    );
  };

  return (
    <section className={cn("pf-card gw-my-notify", className)}>
      <div className="gw-team-notify-card-head">
        <Bell size={16} aria-hidden />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground m-0">
            {t("admin.myNotifyTitle")}
          </h2>
          <p className="pf-muted mt-1 mb-0">{t("admin.myNotifyLead")}</p>
        </div>
      </div>
      <ErrorNote error={prefsError} />
      <div className="gw-team-notify-channels mt-4">
        {NOTIFY_CHANNELS.map(({ key, icon: Icon }) => {
          const locked = !!(channels?.[key] && !channels[key].available);
          const checked = adminNotifyChannelMasterOn(prefs, key);
          return (
            <div
              key={key}
              className={cn("gw-team-notify-channel", locked && "is-locked")}
              title={locked ? t("admin.notifyChannelLocked") : undefined}
            >
              <Icon size={14} aria-hidden />
              <span>{t(`admin.notifyChannel.${key}`)}</span>
              <ChannelSwitch
                checked={checked}
                disabled={locked || prefsSaving}
                ariaLabel={t(`admin.notifyChannel.${key}`)}
                onChange={(v) => toggleChannel(key, v)}
              />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="gw-notify-expand-link mt-3"
        onClick={() => setTypesOpen((v) => !v)}
      >
        {typesOpen ? t("admin.notifyHideTypes") : t("admin.notifyShowTypes")}
      </button>
      {typesOpen ? (
        <div className="gw-notify-prefs mt-3">
          <p className="pf-muted">{t("admin.myNotifyEventHint")}</p>
          <ChannelEventSections
            channels={["email", "in_app", "sms"]}
            disabled={prefsSaving}
            channelLocked={(ch) =>
              !!(channels?.[ch] && !channels[ch].available)
            }
            checked={(ch, k) => !!prefs[ch][k]}
            onToggle={toggleEvent}
          />
        </div>
      ) : null}
    </section>
  );
}
