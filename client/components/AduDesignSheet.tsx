import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BedDouble, Bath, CircleDollarSign, Layers, Ruler, Sofa, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

export type AduDesignId = 1 | 2 | 3;

/** Facts per design (the photo has no baked-in text, so everything here is crisp and translated). */
export const ADU_DESIGNS: Record<AduDesignId, { sqft: number; beds: number; baths: number; extras: Array<{ icon: LucideIcon; key: string }> }> = {
  1: { sqft: 474, beds: 2, baths: 1, extras: [{ icon: CircleDollarSign, key: "rental" }] },
  2: { sqft: 830, beds: 2, baths: 2, extras: [{ icon: Layers, key: "twoStory" }, { icon: Sun, key: "balcony" }] },
  3: { sqft: 445, beds: 1, baths: 1, extras: [{ icon: Sofa, key: "openLiving" }] },
};

export const aduDesignPhoto = (id: AduDesignId) => `/adu/design-photo-${id}.jpg?v=20261019`;

/**
 * Design sheet: gold sq ft block + green title band, the exterior photo, and a clean feature row
 * (bedrooms, bathrooms, size, highlights). Used in the designs stage and its lightbox.
 */
export default function AduDesignSheet({
  id,
  size = "card",
  eager = false,
  photoOverlay,
}: {
  id: AduDesignId;
  size?: "card" | "large";
  eager?: boolean;
  /** Rendered on top of the photo (e.g. the stage's "View larger" pill). */
  photoOverlay?: ReactNode;
}) {
  const { t } = useTranslation();
  const d = ADU_DESIGNS[id];
  const features: Array<{ icon: LucideIcon; value?: string; label: string }> = [
    { icon: BedDouble, value: String(d.beds), label: t("designs.bedrooms", { count: d.beds }) },
    { icon: Bath, value: String(d.baths), label: t("designs.bathrooms", { count: d.baths }) },
    { icon: Ruler, value: String(d.sqft), label: t("designs.sqft") },
    ...d.extras.map((x) => ({ icon: x.icon, label: t(`designs.feature_${x.key}`) })),
  ];
  return (
    <article className={cn("adu-sheet", `adu-sheet--${size}`)}>
      <header className="adu-sheet__head">
        <div className="adu-sheet__size">
          <strong>{d.sqft}</strong>
          <span>{t("designs.sqftShort")}</span>
        </div>
        <div className="adu-sheet__title">
          <strong>{t("designs.bedBath", { beds: d.beds, baths: d.baths })}</strong>
          <span>{t(`designs.type${id}`)}</span>
        </div>
      </header>
      <div className="adu-sheet__photo-wrap">
        <img className="adu-sheet__photo" src={aduDesignPhoto(id)} alt={t(`designs.alt${id}`)} loading={eager ? "eager" : "lazy"} draggable={false} />
        {photoOverlay}
      </div>
      <ul className="adu-sheet__features">
        {features.map((f) => (
          <li key={f.label}>
            <f.icon className="adu-sheet__icon" aria-hidden strokeWidth={1.6} />
            <span className="adu-sheet__feat">
              {f.value ? <strong>{f.value}</strong> : null}
              <span>{f.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
