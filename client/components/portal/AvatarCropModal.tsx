import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/portal/Modal";
import { cropImageToBlob } from "@/lib/cropImage";

type Props = {
  open: boolean;
  imageSrc: string | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => void | Promise<void>;
};

export default function AvatarCropModal({
  open,
  imageSrc,
  busy,
  onClose,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [area, setArea] = useState<Area | null>(null);
  const [encoding, setEncoding] = useState(false);

  const onCropComplete = useCallback((_a: Area, pixels: Area) => {
    setArea(pixels);
  }, []);

  const save = async () => {
    if (!imageSrc || !area || busy || encoding) return;
    setEncoding(true);
    try {
      const blob = await cropImageToBlob(imageSrc, area, {
        size: 512,
        mime: "image/jpeg",
        quality: 0.92,
      });
      await onSave(blob);
    } finally {
      setEncoding(false);
    }
  };

  return (
    <Modal open={open} titleKey="admin.profileCropTitle" onClose={onClose}>
      <div className="pf-avatar-crop">
        <div className="pf-avatar-crop-stage">
          {imageSrc ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : null}
        </div>
        <label className="pf-avatar-crop-zoom">
          <span>{t("admin.profileCropZoom")}</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <div className="pf-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy || encoding}>
            {t("pf.close")}
          </button>
          <button
            type="button"
            className="button button-gold"
            onClick={() => void save()}
            disabled={!area || busy || encoding}
          >
            {busy || encoding ? (
              <Loader2 className="spin" size={16} />
            ) : (
              t("admin.profileCropSave")
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
