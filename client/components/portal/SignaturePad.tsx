import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/**
 * Draw-to-sign pad (mouse, pen, touch). Emits a PNG data URL on each stroke end,
 * or `null` when cleared. Canvas is DPR-scaled so signatures stay crisp.
 */
export default function SignaturePad({
  onChange,
  invalid,
  disabled,
}: {
  onChange: (dataUrl: string | null) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Size the backing store to the rendered box (and re-size on rotate / resize).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0e2a4a";
      setEmpty(true);
      onChange(null);
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(canvas);
    return () => ro?.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (canvas && !empty) onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className={cn("pf-signature", invalid && "pf-field--invalid", disabled && "is-disabled")}>
      <canvas
        ref={canvasRef}
        className="pf-signature-canvas"
        aria-label={t("pf.signature.aria")}
        role="img"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      {empty ? <span className="pf-signature-hint" aria-hidden>{t("pf.signature.hint")}</span> : null}
      <div className="pf-signature-foot">
        <span className="pf-signature-line" aria-hidden />
        <button type="button" className="pf-btn pf-btn--sm" onClick={clear} disabled={disabled || empty}>
          <Eraser size={14} aria-hidden /> {t("pf.signature.clear")}
        </button>
      </div>
    </div>
  );
}
