import { useRef, useState } from "react";
import { useField } from "formik";
import { ImagePlus, Link2, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { uploadEventMedia } from "@/store/slices/eventMediaSlice";
import { useAdminCan } from "@/hooks/useAdminCan";
import { ErrorNote } from "@/components/portal/kit";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/**
 * Event image on the event form: upload a photo (it becomes the event's cover on the public page and
 * cards) or, as a fallback, paste a direct image link (`image_url`). The cover always wins over the link.
 */
export default function EventImageField({ eventId, disabled }: { eventId: number; disabled?: boolean }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const canUpload = useAdminCan("approvals");
  const items = useAppSelector((s) => s.eventMedia.items);
  const [field, meta] = useField<string>("image_url");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(Boolean(field.value));
  const cover = items.find((m) => m.is_cover && m.kind === "photo");
  const preview = cover?.url || (field.value && !meta.error ? field.value : "");

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    const r = await dispatch(uploadEventMedia({ eventId, file, uploadId: `cover-${Date.now()}`, make_cover: true }));
    setBusy(false);
    if (uploadEventMedia.rejected.match(r)) setError(String(r.payload || "errors.uploadFailed"));
  };

  return (
    <div className="gw-event-image">
      <span className="gw-event-image__label">{t("admin.eventImage")}</span>
      <div className="gw-event-image__body">
        <div className={preview ? "gw-event-image__preview" : "gw-event-image__preview is-empty"}>
          {preview ? <img src={preview} alt="" /> : <ImagePlus size={28} aria-hidden />}
        </div>
        <div className="gw-event-image__side">
          <p className="pf-muted">{cover ? t("admin.eventImageFromUpload") : t("admin.eventImageHelp")}</p>
          {canUpload && !disabled ? (
            <>
              <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" className="pf-btn pf-btn--gold" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? <Loader2 size={15} className="spin" aria-hidden /> : cover ? <RefreshCw size={15} aria-hidden /> : <ImagePlus size={15} aria-hidden />}{" "}
                {busy ? t("admin.eventImageUploading") : cover ? t("admin.eventImageReplace") : t("admin.eventImageUpload")}
              </button>
            </>
          ) : null}
          {!showLink && !disabled ? (
            <button type="button" className="text-link gw-event-image__link-toggle" onClick={() => setShowLink(true)}>
              <Link2 size={13} aria-hidden /> {t("admin.eventImageUseLink")}
            </button>
          ) : null}
          {showLink ? (
            <label className="pf-field">
              <span>{t("admin.eventImageUrl")}</span>
              <input {...field} value={field.value || ""} type="url" inputMode="url" placeholder="https://…/photo.jpg" disabled={disabled} />
              {meta.touched && meta.error ? <span className="form-error">{meta.error}</span> : <small className="pf-hint">{t("admin.eventImageUrlHint")}</small>}
            </label>
          ) : null}
          <ErrorNote error={error} />
        </div>
      </div>
    </div>
  );
}
