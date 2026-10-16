import { useEffect, useState } from "react";
import { Megaphone, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearCampaignError,
  clearCampaignPreview,
  createCampaign,
  deleteCampaign,
  fetchCampaign,
  fetchCampaigns,
  previewCampaign,
  sendCampaign,
  updateCampaign,
} from "@/store/slices/campaignsSlice";
import {
  BusyButton,
  ErrorNote,
  HeaderAction,
  Modal,
  PageHeader,
} from "@/components/portal/kit";
import { fetchAdminEvents } from "@/store/slices/adminPortalSlice";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function AdminCampaigns() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { items, active, preview, loading, saving, sending, error, lastStats } =
    useAppSelector((s) => s.campaigns);
  const [confirmLive, setConfirmLive] = useState(false);
  const fmt = useFormatters();

  useEffect(() => {
    dispatch(clearCampaignError());
    void dispatch(fetchCampaigns());
  }, [dispatch]);

  const events = useAppSelector((s) => s.adminPortal.events);
  const [pickEvent, setPickEvent] = useState(false);
  const [eventId, setEventId] = useState("");

  useEffect(() => {
    if (pickEvent) void dispatch(fetchAdminEvents({ limit: 100 }));
  }, [dispatch, pickEvent]);

  /** Lead follow-up for any event: audience = that event's RSVPs, templates use its title/city. */
  const createEventFollowup = async () => {
    const ev = events.items.find((e) => String(e.id) === eventId);
    if (!ev) return;
    const r = await dispatch(
      createCampaign({
        name: t("admin.campaignsEventName", { title: ev.title_en }),
        audience_kind: "leads",
        audience_filter: { event_id: ev.id },
        channels: { email: true, sms: false },
        preset: "event_followup",
      }),
    );
    if (createCampaign.fulfilled.match(r)) {
      setPickEvent(false);
      setEventId("");
      setConfirmLive(false);
      void dispatch(previewCampaign({ id: r.payload.id }));
    }
  };

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="admin.campaignsTitle"
        leadKey="admin.campaignsLead"
        actions={
          <HeaderAction
            icon={Plus}
            labelKey="admin.campaignsCreateEvent"
            onClick={() => setPickEvent(true)}
            disabled={saving}
          />
        }
      />
      <ErrorNote error={error} />

      <Modal open={pickEvent} titleKey="admin.campaignsPickEventTitle" onClose={() => setPickEvent(false)}>
        <div className="pf-form">
          <p className="pf-muted">{t("admin.campaignsPickEventHelp")}</p>
          <label className="pf-field">
            <span>{t("admin.campaignsPickEvent")}</span>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">{events.loading ? t("pf.loading") : t("admin.campaignsPickEventPlaceholder")}</option>
              {events.items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title_en} · {e.city} · {fmt.date(e.starts_at)}
                </option>
              ))}
            </select>
          </label>
          <div className="pf-actions">
            <button type="button" className="pf-btn" onClick={() => setPickEvent(false)}>
              {t("pf.cancel")}
            </button>
            <BusyButton
              tone="gold"
              className="pf-submit"
              label={t("admin.campaignsCreateEvent")}
              busy={saving}
              disabled={!eventId}
              onClick={() => void createEventFollowup()}
            />
          </div>
        </div>
      </Modal>

      <div className="gw-campaigns-layout">
        <section className="pf-card gw-campaigns-list">
          <h2 className="gw-campaigns-section-title">
            <Megaphone size={16} aria-hidden />
            {t("admin.campaignsListTitle")}
          </h2>
          {loading && items.length === 0 ? (
            <p className="pf-muted">{t("pf.loading")}</p>
          ) : items.length === 0 ? (
            <p className="pf-muted">{t("admin.campaignsEmpty")}</p>
          ) : (
            <ul className="gw-campaigns-items">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={cn(
                      "gw-campaigns-item",
                      active?.id === c.id && "is-active",
                    )}
                    onClick={() => {
                      dispatch(clearCampaignPreview());
                      setConfirmLive(false);
                      void dispatch(fetchCampaign(c.id));
                      void dispatch(previewCampaign({ id: c.id }));
                    }}
                  >
                    <strong>{c.name}</strong>
                    <span className="pf-muted">
                      {t(`admin.campaignAudience.${c.audience_kind}`)}
                      {" · "}
                      {t(`admin.campaignStatus.${c.status}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pf-card gw-campaigns-detail min-w-0">
          {!active ? (
            <p className="pf-muted">{t("admin.campaignsSelectHint")}</p>
          ) : (
            <>
              <div className="gw-campaigns-detail-head">
                <div className="min-w-0">
                  <h2 className="m-0 text-lg font-semibold text-foreground break-words">
                    {active.name}
                  </h2>
                  <p className="pf-muted mt-1 mb-0">
                    {t(`admin.campaignAudience.${active.audience_kind}`)}
                    {" · "}
                    {t(`admin.campaignStatus.${active.status}`)}
                    {" · "}
                    {t("admin.campaignChannelsLabel")}:{" "}
                    {[
                      active.channels.email
                        ? t("admin.notifyChannel.email")
                        : null,
                      active.channels.sms
                        ? t("admin.notifyChannel.sms")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>

              <div className="gw-campaigns-filter mt-4">
                <p className="pf-muted mb-2">{t("admin.campaignsFilterHint")}</p>
                <pre className="gw-campaigns-json">
                  {JSON.stringify(active.audience_filter, null, 2)}
                </pre>
              </div>

              {preview ? (
                <div className="gw-campaigns-preview mt-4">
                  <h3 className="m-0 text-sm font-semibold">
                    {t("admin.campaignsPreviewTitle")}
                  </h3>
                  <ul className="gw-campaigns-stats">
                    <li>
                      {t("admin.campaignsStatTotal", { count: preview.total })}
                    </li>
                    <li>
                      {t("admin.campaignsStatEmail", {
                        count: preview.email_eligible,
                      })}
                    </li>
                    <li>
                      {t("admin.campaignsStatSms", {
                        count: preview.sms_eligible,
                      })}
                    </li>
                    <li>
                      {t("admin.campaignsStatSmsSkipped", {
                        count: preview.sms_skipped_no_consent,
                      })}
                    </li>
                    <li>
                      EN {preview.by_lang.en} · ES {preview.by_lang.es}
                    </li>
                  </ul>
                  {preview.sms_skipped_no_consent > 0 ? (
                    <p className="pf-muted text-sm mt-2">
                      {t("admin.campaignsConsentWarning")}
                    </p>
                  ) : null}

                  <h3 className="m-0 mt-4 text-sm font-semibold">
                    {t("admin.campaignsAudienceListTitle", {
                      shown: preview.sample?.length ?? 0,
                      total: preview.total,
                    })}
                  </h3>
                  {(preview.sample?.length ?? 0) === 0 ? (
                    <p className="pf-muted text-sm mt-2 mb-0">
                      {t("admin.campaignsAudienceEmpty")}
                    </p>
                  ) : (
                    <div className="gw-campaigns-audience-wrap mt-2">
                      <table className="gw-campaigns-audience-table">
                        <thead>
                          <tr>
                            <th scope="col">{t("admin.campaignsColName")}</th>
                            <th scope="col">{t("admin.campaignsColEmail")}</th>
                            <th scope="col">{t("admin.campaignsColPhone")}</th>
                            <th scope="col">{t("admin.campaignsColLang")}</th>
                            <th scope="col">{t("admin.campaignsColSms")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(preview.sample ?? []).map((row) => (
                            <tr key={row.id}>
                              <td>{row.name || "—"}</td>
                              <td className="break-all">{row.email || "—"}</td>
                              <td>{row.phone || "—"}</td>
                              <td>{row.lang.toUpperCase()}</td>
                              <td>
                                {row.sms_marketing_consent
                                  ? t("admin.campaignsSmsYes")
                                  : t("admin.campaignsSmsNo")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {preview.sample_truncated ? (
                    <p className="pf-muted text-sm mt-2 mb-0">
                      {t("admin.campaignsAudienceTruncated", {
                        shown: preview.sample?.length ?? 0,
                        total: preview.total,
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {lastStats ? (
                <div className="gw-campaigns-preview mt-4">
                  <h3 className="m-0 text-sm font-semibold">
                    {t("admin.campaignsLastStats")}
                  </h3>
                  <pre className="gw-campaigns-json">
                    {JSON.stringify(lastStats, null, 2)}
                  </pre>
                </div>
              ) : null}

              <div className="gw-campaigns-actions mt-4">
                <BusyButton
                  label={t("admin.campaignsPreview")}
                  busyLabel={t("pf.loading")}
                  busy={loading}
                  disabled={saving || sending}
                  onClick={() =>
                    void dispatch(previewCampaign({ id: active.id }))
                  }
                />
                <BusyButton
                  label={t("admin.campaignsDryRun")}
                  busyLabel={t("pf.busy.submitting")}
                  busy={sending}
                  disabled={
                    saving ||
                    loading ||
                    (active.status !== "draft" && active.status !== "failed")
                  }
                  onClick={() =>
                    void dispatch(
                      sendCampaign({ id: active.id, dry_run: true }),
                    )
                  }
                />
                {active.status === "draft" || active.status === "failed" ? (
                  <label className="gw-campaigns-confirm">
                    <input
                      type="checkbox"
                      checked={confirmLive}
                      onChange={(e) => setConfirmLive(e.target.checked)}
                    />
                    <span>{t("admin.campaignsConfirmLive")}</span>
                  </label>
                ) : null}
                <BusyButton
                  label={t("admin.campaignsSendLive")}
                  busyLabel={t("pf.busy.submitting")}
                  busy={sending}
                  disabled={
                    !confirmLive ||
                    saving ||
                    loading ||
                    (active.status !== "draft" && active.status !== "failed")
                  }
                  onClick={() =>
                    void dispatch(
                      sendCampaign({ id: active.id, confirm: true }),
                    )
                  }
                />
                <BusyButton
                  label={t("admin.campaignsToggleSms")}
                  busyLabel={t("pf.busy.savingStatus")}
                  busy={saving}
                  disabled={
                    sending ||
                    (active.status !== "draft" && active.status !== "failed")
                  }
                  onClick={() =>
                    void dispatch(
                      updateCampaign({
                        id: active.id,
                        patch: {
                          channels: {
                            email: active.channels.email,
                            sms: !active.channels.sms,
                          },
                        },
                      }),
                    )
                  }
                />
                <BusyButton
                  label={t("admin.campaignsDelete")}
                  busyLabel={t("pf.busy.removing")}
                  busy={saving}
                  disabled={sending || active.status === "sending"}
                  onClick={() => void dispatch(deleteCampaign(active.id))}
                />
              </div>

              <div className="gw-campaigns-templates mt-5">
                <h3 className="m-0 text-sm font-semibold">
                  {t("admin.campaignsTemplatesTitle")}
                </h3>
                <ul className="gw-campaigns-template-list">
                  {active.templates.map((tpl) => (
                    <li key={tpl.role}>
                      <strong>{t(`admin.campaignTemplateRole.${tpl.role}`)}</strong>
                      {tpl.subject_en ? (
                        <p className="text-sm mt-1 mb-0 break-words">
                          <span className="pf-muted">
                            {t("admin.campaignsSubjectLabel")}:{" "}
                          </span>
                          {tpl.subject_en}
                        </p>
                      ) : null}
                      <p className="pf-muted text-sm mt-1 mb-0 whitespace-pre-wrap break-words">
                        {(tpl.sms_body_en || "").slice(0, 280)}
                        {(tpl.sms_body_en || "").length > 280 ? "…" : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
