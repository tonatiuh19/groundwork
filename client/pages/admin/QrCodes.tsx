import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, BarChart3, Download, ExternalLink, Plus, QrCode, ScanLine } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { QrLink } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearQrError,
  createQrExternalLink,
  createQrLink,
  fetchQrExternalLinks,
  fetchQrInsights,
  fetchQrLinks,
  updateQrExternalLink,
  updateQrLink,
} from "@/store/slices/qrLinksSlice";
import { BusyButton, CopyButton, EmptyState, ErrorNote, HeaderAction, Loading, Modal, PageHeader, SegmentedTabs } from "@/components/portal/kit";
import EventQrCode from "@/components/events/EventQrCode";
import QrDestinationPicker, { useQrDestLabel, type QrPicked } from "@/components/admin/QrDestinationPicker";
import { downloadBrandQr } from "@/lib/brandQr";
import { slugifyEvent } from "@/lib/eventOptions";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/cn";

const sameDest = (a: QrPicked | null, b: QrPicked | null) => (a?.type ?? null) === (b?.type ?? null) && (a?.key ?? null) === (b?.key ?? null) && (a?.id ?? null) === (b?.id ?? null);

/** One printed code: QR, permanent short link, picked destination + fallback, on/off, results. */
function QrCard({ item, canEdit, onResults }: { item: QrLink; canEdit: boolean; onResults: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const [dest, setDest] = useState<QrPicked | null>(item.destination);
  const [fallback, setFallback] = useState<QrPicked | null>(item.fallback);
  const [label, setLabel] = useState(item.label);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDest(item.destination);
    setFallback(item.fallback);
    setLabel(item.label);
  }, [item.destination, item.fallback, item.label]);
  const destDirty = !sameDest(dest, item.destination);
  const fallbackDirty = !sameDest(fallback, item.fallback);
  const dirty = destDirty || fallbackDirty || label.trim() !== item.label;
  const editable = canEdit && !item.archived;

  const save = async (body: Parameters<typeof updateQrLink>[0]["body"]) => {
    setBusy(true);
    setDone(false);
    const r = await dispatch(updateQrLink({ id: item.id, body }));
    setBusy(false);
    if (updateQrLink.fulfilled.match(r)) setDone(true);
  };
  const download = async (kind: "png" | "svg") => {
    try {
      await downloadBrandQr(item.short_url, kind, `groundwork-qr-${item.slug}`);
    } catch (e) {
      logger.error("qrCodes", e);
    }
  };

  return (
    <article className={cn("pf-card gw-qr-card", (!item.active || item.archived) && "is-off")}>
      <div className="gw-qr-card__code">
        <EventQrCode url={item.short_url} label={t("qrCodes.qrAria", { label: item.label })} />
        <div className="gw-qr-card__dl">
          <BusyButton icon={Download} label="PNG" tone="gold" onClick={() => void download("png")} />
          <BusyButton icon={Download} label="SVG" onClick={() => void download("svg")} />
        </div>
      </div>
      <div className="gw-qr-card__body">
        <label className="pf-field">
          <span>{t("qrCodes.label")}</span>
          <input value={label} maxLength={160} disabled={!editable} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <div className="gw-qr-card__short">
          <code className="pf-code">{item.short_url.replace(/^https?:\/\//, "")}</code>
          <CopyButton value={item.short_url} compact />
        </div>
        {!item.destination ? <p className="gw-qr-warn">{t("qrCodes.legacy", { url: item.destination_url })}</p> : null}
        {item.destination && !item.destination.ok ? <p className="gw-qr-warn">{t("qrCodes.broken")}</p> : null}
        <QrDestinationPicker
          label={t("qrCodes.destination")}
          value={dest}
          disabled={!editable}
          onChange={(v) => {
            setDest(v);
            setDone(false);
          }}
        />
        <QrDestinationPicker
          clearable
          label={t("qrCodes.fallback")}
          value={fallback}
          disabled={!editable}
          onChange={(v) => {
            setFallback(v);
            setDone(false);
          }}
        />
        <div className="gw-qr-card__actions">
          {editable ? (
            <BusyButton
              tone="gold"
              label={t("pf.save")}
              doneLabel={t("qrCodes.saved")}
              busy={busy}
              done={done && !dirty}
              disabled={!dirty || !dest || !label.trim()}
              onClick={() =>
                void save({
                  label: label.trim(),
                  ...(destDirty && dest ? { destination: dest } : {}),
                  ...(fallbackDirty ? { fallback } : {}),
                })
              }
            />
          ) : null}
          <a className="pf-btn" href={`${item.short_url}?test=1`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} aria-hidden /> {t("qrCodes.test")}
          </a>
          <BusyButton icon={BarChart3} label={t("qrCodes.details")} onClick={onResults} />
          {editable ? (
            <label className="gw-qr-card__toggle">
              <input type="checkbox" checked={item.active} disabled={busy} onChange={(e) => void save({ active: e.target.checked })} />
              <span>{item.active ? t("qrCodes.on") : t("qrCodes.off")}</span>
            </label>
          ) : null}
          {canEdit ? (
            <BusyButton
              icon={item.archived ? ArchiveRestore : Archive}
              label={t(item.archived ? "qrCodes.restore" : "qrCodes.archive")}
              disabled={busy}
              onClick={() => void save({ archived: !item.archived })}
            />
          ) : null}
        </div>
        <p className="gw-qr-card__stats">
          <ScanLine size={14} aria-hidden /> {t("qrCodes.scans", { count: item.scan_count })}
          {item.last_scanned_at ? ` · ${t("qrCodes.lastScan", { date: fmt.relative(item.last_scanned_at) })}` : ""}
          {` · ${t("qrCodes.leads", { count: item.lead_count })} · ${t("qrCodes.applications", { count: item.application_count })}`}
        </p>
      </div>
    </article>
  );
}

/** Results for one code: scans over time, scans per destination, and who changed what. */
function QrResults({ item, onClose }: { item: QrLink; onClose: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { insights, insightsLoading } = useAppSelector((s) => s.qrLinks);
  useEffect(() => {
    void dispatch(fetchQrInsights(item.id));
  }, [dispatch, item.id]);
  const max = Math.max(1, ...(insights?.days.map((d) => d.scans) ?? []));
  const pageLabel = (v: string | null) => (v?.startsWith("page:") ? t(`qrCodes.page_${v.slice(5)}`) : v);
  const destLabel = (ref: string, label: string) => (ref.startsWith("page:") ? t(`qrCodes.page_${ref.slice(5)}`) : label);

  return (
    <Modal open titleKey="qrCodes.details" onClose={onClose}>
      <p className="pf-hint">{item.label}</p>
      {insightsLoading ? <Loading /> : null}
      {insights ? (
        <div className="pf-form">
          <h3>{t("qrCodes.last90")}</h3>
          {insights.days.length ? (
            <div className="gw-qr-bars" role="img" aria-label={t("qrCodes.scans", { count: item.scan_count })}>
              {insights.days.map((d) => (
                <i key={d.day} title={`${d.day}: ${d.scans}`} style={{ height: `${(d.scans / max) * 100}%` }} />
              ))}
            </div>
          ) : (
            <p className="pf-hint">{t("qrCodes.noScans")}</p>
          )}
          {insights.destinations.length ? (
            <>
              <h3>{t("qrCodes.byDestination")}</h3>
              <div className="gw-qr-rows">
                {insights.destinations.map((d) => (
                  <div key={d.ref} className="gw-qr-row">
                    <div>{destLabel(d.ref, d.label)}</div>
                    <strong>{d.scans}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <h3>{t("qrCodes.history")}</h3>
          {!insights.changes.length ? <p className="pf-hint">{t("qrCodes.noHistory")}</p> : null}
          <div className="gw-qr-rows">
            {insights.changes.map((c) => (
              <div key={c.id} className="gw-qr-row">
                <div>
                  <strong>{t(`qrCodes.change_${c.action}`)}</strong>
                  {c.before || c.after ? <small>{[pageLabel(c.before), pageLabel(c.after)].filter(Boolean).join(" → ")}</small> : null}
                </div>
                <small>
                  {c.admin_name || t("qrCodes.system")} · {fmt.relative(c.created_at)}
                </small>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** Read-only list of each event's own code, so all printed codes can be seen together. */
function EventCodes() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const codes = useAppSelector((s) => s.qrLinks.eventCodes);
  if (!codes.length) return <EmptyState messageKey="qrCodes.emptyEvents" />;
  return (
    <section className="pf-card gw-qr-rows">
      <p className="pf-hint">{t("qrCodes.eventCodesHint")}</p>
      {codes.map((e) => (
        <div key={e.id} className="gw-qr-row">
          <div>
            <strong>{e.title}</strong>
            <small>{[e.city, e.starts_at ? fmt.date(e.starts_at) : null, e.short_url.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ")}</small>
            <small>
              {t("qrCodes.scans", { count: e.scan_count })} · {t("qrCodes.rsvps", { count: e.rsvp_count })}
            </small>
          </div>
          <Link className="pf-btn pf-btn--sm" to={`/admin/events/${e.id}`}>
            {t("qrCodes.openEvent")}
          </Link>
        </div>
      ))}
    </section>
  );
}

/** Approved external links: admins vet them once, then staff only pick them from the search. */
function ExternalLinks() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { externals, saving, error } = useAppSelector((s) => s.qrLinks);
  const canManage = useAdminCan("approvals");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    void dispatch(fetchQrExternalLinks());
  }, [dispatch]);
  const add = async () => {
    const r = await dispatch(createQrExternalLink({ label: label.trim(), url: url.trim() }));
    if (createQrExternalLink.fulfilled.match(r)) {
      setLabel("");
      setUrl("");
    }
  };
  return (
    <section className="pf-card gw-qr-rows">
      <p className="pf-hint">{t(canManage ? "qrCodes.externalHint" : "qrCodes.externalOnlyAdmins")}</p>
      {canManage ? (
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("qrCodes.externalLabel")}</span>
            <input value={label} maxLength={160} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="pf-field">
            <span>{t("qrCodes.externalUrl")}</span>
            <input type="url" inputMode="url" value={url} maxLength={1000} spellCheck={false} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
          </label>
          <ErrorNote error={error} />
          <div className="pf-actions">
            <BusyButton tone="gold" icon={Plus} label={t("qrCodes.externalAdd")} busy={saving} disabled={!label.trim() || !url.trim()} onClick={() => void add()} />
          </div>
        </div>
      ) : null}
      {!externals.length ? <EmptyState messageKey="qrCodes.emptyExternal" /> : null}
      {externals.map((x) => (
        <div key={x.id} className="gw-qr-row">
          <div>
            <strong>{x.label}</strong>
            <small>{x.url}</small>
          </div>
          {canManage ? (
            <label className="gw-qr-card__toggle">
              <input type="checkbox" checked={x.active} onChange={(e) => void dispatch(updateQrExternalLink({ id: x.id, body: { active: e.target.checked } }))} />
              <span>{t(x.active ? "qrCodes.externalOn" : "qrCodes.externalOff")}</span>
            </label>
          ) : (
            <small>{t(x.active ? "qrCodes.externalOn" : "qrCodes.externalOff")}</small>
          )}
        </div>
      ))}
    </section>
  );
}

type QrTab = "codes" | "events" | "archived" | "external";

/**
 * Admin -> QR codes: every printed code. /go/{slug} codes are permanent; staff pick where they go
 * from real records, and see scans, leads, applications and change history. Event codes are listed
 * read-only.
 */
export default function QrCodes() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { items, eventCodes, loading, saving, error } = useAppSelector((s) => s.qrLinks);
  const canEdit = useAdminCan("events");
  const [tab, setTab] = useState<QrTab>("codes");
  const [open, setOpen] = useState(false);
  const [resultsId, setResultsId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [dest, setDest] = useState<QrPicked | null>(null);
  const [fallback, setFallback] = useState<QrPicked | null>(null);

  useEffect(() => {
    void dispatch(fetchQrLinks());
  }, [dispatch]);

  const cleanSlug = slugifyEvent(slugTouched ? slug : label).slice(0, 64).replace(/-+$/, "");
  const close = () => {
    setOpen(false);
    setLabel("");
    setSlug("");
    setSlugTouched(false);
    setDest(null);
    setFallback(null);
    dispatch(clearQrError());
  };
  const create = async () => {
    if (!dest) return;
    const r = await dispatch(createQrLink({ label: label.trim(), slug: cleanSlug, destination: dest, fallback }));
    if (createQrLink.fulfilled.match(r)) close();
  };
  const live = items.filter((q) => !q.archived);
  const archived = items.filter((q) => q.archived);
  const shown = tab === "archived" ? archived : live;
  const results = items.find((q) => q.id === resultsId);

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="qrCodes.title"
        leadKey="qrCodes.lead"
        actions={canEdit ? <HeaderAction labelKey="qrCodes.new" icon={QrCode} onClick={() => setOpen(true)} /> : null}
      />
      <SegmentedTabs<QrTab>
        value={tab}
        onChange={setTab}
        ariaLabel={t("qrCodes.tabsAria")}
        options={[
          { value: "codes", labelKey: "qrCodes.tabCodes", count: live.length || null },
          { value: "events", labelKey: "qrCodes.tabEvents", count: eventCodes.length || null },
          { value: "external", labelKey: "qrCodes.tabExternal" },
          { value: "archived", labelKey: "qrCodes.tabArchived", count: archived.length || null },
        ]}
      />
      {!open && tab !== "external" ? <ErrorNote error={error} /> : null}
      {loading && !items.length ? <Loading /> : null}
      {tab === "events" ? <EventCodes /> : null}
      {tab === "external" ? <ExternalLinks /> : null}
      {(tab === "codes" || tab === "archived") && !loading && !shown.length ? <EmptyState messageKey={tab === "codes" ? "qrCodes.empty" : "qrCodes.emptyArchived"} /> : null}
      {tab === "codes" || tab === "archived" ? (
        <div className="gw-qr-grid">
          {shown.map((q) => (
            <QrCard key={q.id} item={q} canEdit={canEdit} onResults={() => setResultsId(q.id)} />
          ))}
        </div>
      ) : null}
      {results ? <QrResults item={results} onClose={() => setResultsId(null)} /> : null}

      <Modal open={open} titleKey="qrCodes.new" onClose={close}>
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("qrCodes.label")}</span>
            <input value={label} maxLength={160} placeholder={t("qrCodes.labelPh")} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="pf-field">
            <span>{t("qrCodes.slug")}</span>
            <input
              value={slugTouched ? slug : cleanSlug}
              maxLength={64}
              spellCheck={false}
              placeholder="canopy"
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
          </label>
          <p className="pf-hint">{t("qrCodes.slugHint", { url: `${window.location.host}/go/${cleanSlug || "canopy"}` })}</p>
          <QrDestinationPicker label={t("qrCodes.destination")} value={dest} onChange={setDest} />
          <QrDestinationPicker clearable label={t("qrCodes.fallback")} value={fallback} onChange={setFallback} />
          <ErrorNote error={error} />
          <div className="pf-actions">
            <BusyButton
              tone="gold"
              label={t("qrCodes.create")}
              busy={saving}
              disabled={!label.trim() || cleanSlug.length < 2 || !dest}
              onClick={() => void create()}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
