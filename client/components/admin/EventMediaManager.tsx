import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Film, ImagePlus, Link2, Star, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdminEventMedia } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addEventEmbed,
  clearEventMedia,
  deleteEventMedia,
  fetchEventMedia,
  reorderEventMedia,
  updateEventMedia,
  uploadEventMedia,
} from "@/store/slices/eventMediaSlice";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";

const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";

function Thumb({ m }: { m: AdminEventMedia }) {
  if (m.kind === "photo") return <img src={m.url} alt="" loading="lazy" />;
  if (m.kind === "video") return <video src={m.url} preload="metadata" muted playsInline />;
  return (
    <span className="gw-event-media-embed">
      <Film size={22} aria-hidden /> {m.embed_provider}
    </span>
  );
}

/**
 * Admin "Photos & videos" for an event: upload photos/videos (direct to Blob),
 * paste Instagram / YouTube / TikTok links, pick the cover + highlight reel,
 * captions EN/ES, reorder and delete. Writes are admins only (approvals).
 */
export default function EventMediaManager({ eventId, isPast }: { eventId: number; isPast: boolean }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const canWrite = useAdminCan("approvals");
  const { items, loading, saving, error, uploads } = useAppSelector((s) => s.eventMedia);
  const [link, setLink] = useState("");
  const [captions, setCaptions] = useState<Record<number, { en: string; es: string }>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void dispatch(fetchEventMedia(eventId));
    return () => {
      dispatch(clearEventMedia());
    };
  }, [dispatch, eventId]);

  useEffect(() => {
    // Seed new items from the server; keep in-progress edits on existing ones.
    setCaptions((prev) =>
      Object.fromEntries(
        items.map((m) => [m.id, prev[m.id] ?? { en: m.caption_en || "", es: m.caption_es || "" }]),
      ),
    );
  }, [items]);

  const onFiles = (files: FileList | null) => {
    for (const file of Array.from(files || [])) {
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      void dispatch(uploadEventMedia({ eventId, file, uploadId }));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const move = (idx: number, dir: -1 | 1) => {
    const ids = items.map((m) => m.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    void dispatch(reorderEventMedia({ eventId, ids }));
  };

  const pending = Object.entries(uploads);

  return (
    <section className="pf-section gw-event-media">
      <div className="pf-section-head">
        <h2 className="pf-h2">{t("admin.eventMediaTitle")}</h2>
        <span className="pf-muted">{t("admin.eventMediaCount", { count: items.length })}</span>
      </div>
      <p className="pf-hint">{t(isPast ? "admin.eventMediaHintPast" : "admin.eventMediaHintUpcoming")}</p>
      <ErrorNote error={error} />

      {canWrite ? (
        <div className="gw-event-media-add">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
          <BusyButton icon={Upload} label={t("admin.eventMediaUpload")} onClick={() => fileRef.current?.click()} />
          <form
            className="gw-event-media-link"
            onSubmit={(e) => {
              e.preventDefault();
              if (!link.trim()) return;
              void dispatch(addEventEmbed({ eventId, embed_url: link.trim() })).then((r) => {
                if (addEventEmbed.fulfilled.match(r)) setLink("");
              });
            }}
          >
            <label className="pf-field">
              <span>
                <Link2 size={13} aria-hidden /> {t("admin.eventMediaLink")}
              </span>
              <input
                type="url"
                value={link}
                placeholder="https://www.instagram.com/reel/…"
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
            <BusyButton type="submit" label={t("admin.eventMediaAddLink")} busy={saving} disabled={!link.trim()} />
          </form>
          <small className="pf-hint">{t("admin.eventMediaLimits")}</small>
        </div>
      ) : (
        <p className="pf-muted">{t("admin.eventMediaReadOnly")}</p>
      )}

      {pending.length ? (
        <ul className="gw-event-media-progress">
          {pending.map(([id, pct]) => (
            <li key={id}>
              <ImagePlus size={14} aria-hidden /> {t("admin.eventMediaUploading", { pct })}
              <progress max={100} value={pct} />
            </li>
          ))}
        </ul>
      ) : null}

      {loading && !items.length ? (
        <Loading />
      ) : !items.length ? (
        <p className="pf-muted">{t("admin.eventMediaEmpty")}</p>
      ) : (
        <ul className="gw-event-media-grid">
          {items.map((m, i) => {
            const c = captions[m.id] || { en: "", es: "" };
            const dirty = c.en !== (m.caption_en || "") || c.es !== (m.caption_es || "");
            return (
              <li key={m.id} className="gw-event-media-item">
                <div className="gw-event-media-thumb">
                  <Thumb m={m} />
                  {m.is_cover ? <span className="gw-event-media-tag">{t("admin.eventMediaCover")}</span> : null}
                  {m.is_highlight ? (
                    <span className="gw-event-media-tag gw-event-media-tag--reel">{t("admin.eventMediaReel")}</span>
                  ) : null}
                </div>
                {canWrite ? (
                  <div className="gw-event-media-controls">
                    <label className="pf-field">
                      <span>{t("admin.captionEn")}</span>
                      <input
                        value={c.en}
                        maxLength={300}
                        onChange={(e) => setCaptions((p) => ({ ...p, [m.id]: { ...c, en: e.target.value } }))}
                      />
                    </label>
                    <label className="pf-field">
                      <span>{t("admin.captionEs")}</span>
                      <input
                        value={c.es}
                        maxLength={300}
                        onChange={(e) => setCaptions((p) => ({ ...p, [m.id]: { ...c, es: e.target.value } }))}
                      />
                    </label>
                    <div className="gw-event-media-actions">
                      {dirty ? (
                        <BusyButton
                          tone="gold"
                          label={t("pf.save")}
                          busy={saving}
                          onClick={() =>
                            void dispatch(
                              updateEventMedia({
                                eventId,
                                id: m.id,
                                patch: { caption_en: c.en || null, caption_es: c.es || null },
                              }),
                            ).then((r) => {
                              if (updateEventMedia.fulfilled.match(r)) {
                                const saved = r.payload.find((x) => x.id === m.id);
                                setCaptions((p) => ({
                                  ...p,
                                  [m.id]: { en: saved?.caption_en || "", es: saved?.caption_es || "" },
                                }));
                              }
                            })
                          }
                        />
                      ) : null}
                      {m.kind === "photo" ? (
                        <BusyButton
                          icon={Star}
                          label={t(m.is_cover ? "admin.eventMediaUnsetCover" : "admin.eventMediaSetCover")}
                          disabled={saving}
                          onClick={() =>
                            void dispatch(updateEventMedia({ eventId, id: m.id, patch: { is_cover: !m.is_cover } }))
                          }
                        />
                      ) : (
                        <BusyButton
                          icon={Film}
                          label={t(m.is_highlight ? "admin.eventMediaUnsetReel" : "admin.eventMediaSetReel")}
                          disabled={saving}
                          onClick={() =>
                            void dispatch(
                              updateEventMedia({ eventId, id: m.id, patch: { is_highlight: !m.is_highlight } }),
                            )
                          }
                        />
                      )}
                      <button
                        type="button"
                        className="pf-icon-btn"
                        aria-label={t("admin.moveUp")}
                        disabled={saving || i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="pf-icon-btn"
                        aria-label={t("admin.moveDown")}
                        disabled={saving || i === items.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="pf-icon-btn pf-icon-btn--danger"
                        aria-label={t("admin.eventMediaDelete")}
                        disabled={saving}
                        onClick={() => {
                          if (window.confirm(t("admin.eventMediaDeleteConfirm"))) {
                            void dispatch(deleteEventMedia({ eventId, id: m.id }));
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ) : m.caption_en ? (
                  <p className="pf-muted">{m.caption_en}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
