/**
 * Settings → Team notifications (Optimum parity):
 * staff channel masters + per-channel alert types, and extra email recipients.
 */
import { useEffect, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Bell, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  createNotifyExtra,
  deleteNotifyExtra,
  fetchNotifyRecipients,
  updateNotifyExtra,
  updateStaffNotifyPrefs,
} from "@/store/slices/adminPortalSlice";
import {
  BusyButton,
  ErrorNote,
  SubmitButton,
  TextField,
  useRowBusy,
} from "@/components/portal/kit";
import {
  adminNotifyChannelMasterOn,
  notifyExtraAllowsEvent,
  toggleNotifyExtraEvent,
} from "@/lib/adminNotifyPrefs";
import type {
  AdminNotifyChannel,
  AdminNotifyEventKey,
  AdminNotifyExtraEmail,
  AdminNotifyStaffRecipient,
} from "@shared/api";
import { cn } from "@/lib/cn";
import {
  ChannelEventSections,
  ChannelSwitch,
  EventTypeToggles,
  NOTIFY_CHANNELS,
} from "@/components/admin/AdminNotifyPrefsControls";

type Props = { className?: string };

export function TeamNotificationsPanel({ className }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    staff,
    extras,
    loading,
    saving: prefsSaving,
    error,
  } = useAppSelector((s) => s.adminPortal.notifyRecipients);
  const portalSaving = useAppSelector((s) => s.adminPortal.saving);
  const saveError = useAppSelector((s) => s.adminPortal.saveError);
  const saving = prefsSaving || portalSaving;
  const rowBusy = useRowBusy();
  const [expandedStaff, setExpandedStaff] = useState<number | null>(null);
  const [expandedExtra, setExpandedExtra] = useState<number | null>(null);

  useEffect(() => {
    dispatch(clearAdminSaveError());
    void dispatch(fetchNotifyRecipients());
  }, [dispatch]);

  const extraSchema = Yup.object({
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .required(t("validation.emailRequired")),
    label: Yup.string().trim(),
  });

  const toggleStaffChannel = (
    row: AdminNotifyStaffRecipient,
    channel: AdminNotifyChannel,
    value: boolean,
  ) => {
    if (row.channels?.[channel] && !row.channels[channel].available) return;
    void dispatch(
      updateStaffNotifyPrefs({
        id: row.id,
        patch: { channel_masters: { [channel]: value } },
      }),
    );
  };

  const toggleStaffEvent = (
    row: AdminNotifyStaffRecipient,
    channel: AdminNotifyChannel,
    eventKey: AdminNotifyEventKey,
    value: boolean,
  ) => {
    if (row.channels?.[channel] && !row.channels[channel].available) return;
    void dispatch(
      updateStaffNotifyPrefs({
        id: row.id,
        patch: { [channel]: { [eventKey]: value } },
      }),
    );
  };

  const toggleExtraEvent = (
    row: AdminNotifyExtraEmail,
    eventKey: AdminNotifyEventKey,
    value: boolean,
  ) => {
    const events = toggleNotifyExtraEvent(row.events, eventKey, value);
    void rowBusy.run(row.id, "events", async () => {
      const r = await dispatch(
        updateNotifyExtra({ id: row.id, patch: { events } }),
      );
      return updateNotifyExtra.fulfilled.match(r);
    });
  };

  return (
    <div className={cn("gw-team-notify", className)}>
      <div className="gw-team-notify-head">
        <h2 className="gw-team-notify-title">
          <Bell size={16} aria-hidden />
          {t("admin.notifyPanelTitle")}
        </h2>
        <p className="pf-muted">{t("admin.notifyPanelSubtitle")}</p>
      </div>
      <ErrorNote error={error || saveError} />

      <section className="pf-card gw-team-notify-card">
        <div className="gw-team-notify-card-head">
          <Users size={16} aria-hidden />
          <div className="min-w-0">
            <h3>{t("admin.notifyStaffTitle")}</h3>
            <p className="pf-muted">{t("admin.notifyStaffSubtitle")}</p>
          </div>
        </div>
        {loading && staff.length === 0 ? (
          <p className="pf-muted">{t("pf.loading")}</p>
        ) : staff.length === 0 ? (
          <p className="pf-muted">{t("admin.notifyStaffEmpty")}</p>
        ) : (
          <ul className="gw-team-notify-list">
            {staff.map((row) => {
              const name =
                `${row.first_name} ${row.last_name}`.trim() || row.email;
              const open = expandedStaff === row.id;
              return (
                <li key={row.id} className="gw-team-notify-row">
                  <div className="gw-team-notify-row-top">
                    <button
                      type="button"
                      className="gw-notify-expand"
                      onClick={() =>
                        setExpandedStaff(open ? null : row.id)
                      }
                    >
                      <strong>{name}</strong>
                      <span className="pf-muted">
                        {row.email}
                        {" · "}
                        {t(`role.${row.role}`, { defaultValue: row.role })}
                        {" · "}
                        <span className="gw-notify-expand-link">
                          {open
                            ? t("admin.notifyHideTypes")
                            : t("admin.notifyShowTypes")}
                        </span>
                      </span>
                    </button>
                    <div className="gw-team-notify-channels">
                      {NOTIFY_CHANNELS.map(({ key, icon: Icon }) => {
                        const locked = !row.channels?.[key]?.available;
                        const checked = adminNotifyChannelMasterOn(
                          row.prefs,
                          key,
                        );
                        return (
                          <div
                            key={key}
                            className={cn(
                              "gw-team-notify-channel",
                              locked && "is-locked",
                            )}
                            title={
                              locked
                                ? t("admin.notifyChannelLocked")
                                : undefined
                            }
                          >
                            <Icon size={14} aria-hidden />
                            <span>{t(`admin.notifyChannel.${key}`)}</span>
                            <ChannelSwitch
                              checked={checked}
                              disabled={locked || saving}
                              ariaLabel={`${name} — ${t(`admin.notifyChannel.${key}`)}`}
                              onChange={(v) =>
                                toggleStaffChannel(row, key, v)
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {open ? (
                    <div className="gw-notify-prefs">
                      <p className="pf-muted">
                        {t("admin.notifyStaffEventHint")}
                      </p>
                      <ChannelEventSections
                        channels={["email", "in_app", "sms"]}
                        disabled={saving}
                        channelLocked={(ch) =>
                          !row.channels?.[ch]?.available
                        }
                        checked={(ch, k) => !!row.prefs[ch][k]}
                        onToggle={(ch, k, v) =>
                          toggleStaffEvent(row, ch, k, v)
                        }
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="pf-card gw-team-notify-card">
        <div className="gw-team-notify-card-head">
          <div className="min-w-0">
            <h3>{t("admin.notifyExtrasTitle")}</h3>
            <p className="pf-muted">{t("admin.notifyExtrasLead")}</p>
          </div>
        </div>

        <Formik
          initialValues={{ email: "", label: "" }}
          validationSchema={extraSchema}
          onSubmit={async (v, { resetForm }) => {
            const r = await dispatch(
              createNotifyExtra({
                email: v.email.trim(),
                label: v.label.trim() || null,
              }),
            );
            if (createNotifyExtra.fulfilled.match(r)) {
              resetForm();
              void dispatch(fetchNotifyRecipients());
            }
          }}
        >
          <Form className="pf-form gw-team-notify-add">
            <ErrorNote error={saveError} />
            <div className="pf-form-grid">
              <TextField name="email" labelKey="form.email" type="email" />
              <TextField name="label" labelKey="admin.notifyExtraLabel" />
            </div>
            <SubmitButton busy={saving} labelKey="admin.notifyExtrasAdd" />
          </Form>
        </Formik>

        {loading && extras.length === 0 ? (
          <p className="pf-muted">{t("pf.loading")}</p>
        ) : extras.length === 0 ? (
          <p className="pf-muted">{t("admin.noNotifyExtras")}</p>
        ) : (
          <ul className="gw-team-notify-list">
            {extras.map((extra) => {
              const open = expandedExtra === extra.id;
              const eventsSummary =
                extra.events == null
                  ? t("admin.notifyEventsAll")
                  : t("admin.notifyEventsSelected", {
                      count: extra.events.length,
                    });
              return (
                <li key={extra.id} className="gw-team-notify-row">
                  <div className="gw-team-notify-row-top">
                    <button
                      type="button"
                      className="gw-notify-expand"
                      onClick={() =>
                        setExpandedExtra(open ? null : extra.id)
                      }
                    >
                      <strong>{extra.email}</strong>
                      <span className="pf-muted">
                        {extra.label ? `${extra.label} · ` : ""}
                        {eventsSummary}
                        {" · "}
                        <span className="gw-notify-expand-link">
                          {open
                            ? t("admin.notifyHideTypes")
                            : t("admin.notifyShowTypes")}
                        </span>
                      </span>
                    </button>
                    <div className="gw-team-notify-extra-actions">
                      <div className="gw-team-notify-channel">
                        <span>
                          {extra.is_active
                            ? t("admin.notifyExtraOn")
                            : t("admin.notifyExtraPaused")}
                        </span>
                        <ChannelSwitch
                          checked={extra.is_active}
                          disabled={saving || rowBusy.isRowLocked(extra.id)}
                          ariaLabel={t("admin.notifyExtraToggleAria", {
                            email: extra.email,
                          })}
                          onChange={(next) => {
                            void rowBusy.run(extra.id, "toggle", async () => {
                              const r = await dispatch(
                                updateNotifyExtra({
                                  id: extra.id,
                                  patch: { is_active: next },
                                }),
                              );
                              return updateNotifyExtra.fulfilled.match(r);
                            });
                          }}
                        />
                      </div>
                      <BusyButton
                        icon={Trash2}
                        label={t("admin.notifyExtraDelete")}
                        busyLabel={t("pf.busy.removing")}
                        doneLabel={t("pf.done.removed")}
                        busy={rowBusy.isBusy(extra.id, "delete")}
                        done={rowBusy.isDone(extra.id, "delete")}
                        disabled={
                          saving ||
                          (rowBusy.isRowLocked(extra.id) &&
                            !rowBusy.isBusy(extra.id, "delete") &&
                            !rowBusy.isDone(extra.id, "delete"))
                        }
                        onClick={() => {
                          void rowBusy.run(
                            extra.id,
                            "delete",
                            async () => {
                              const r = await dispatch(
                                deleteNotifyExtra(extra.id),
                              );
                              return deleteNotifyExtra.fulfilled.match(r);
                            },
                            {
                              flash: true,
                              onFlashEnd: () =>
                                void dispatch(fetchNotifyRecipients()),
                            },
                          );
                        }}
                      />
                    </div>
                  </div>
                  {open ? (
                    <div className="gw-notify-prefs">
                      <p className="pf-muted">
                        {t("admin.notifyExtraEventHint")}
                      </p>
                      <EventTypeToggles
                        disabled={
                          !extra.is_active ||
                          saving ||
                          rowBusy.isRowLocked(extra.id)
                        }
                        checked={(k) =>
                          notifyExtraAllowsEvent(extra.events, k)
                        }
                        onToggle={(k, v) => toggleExtraEvent(extra, k, v)}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
