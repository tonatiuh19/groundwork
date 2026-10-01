/** Build a square JPEG/WebP blob from an image + react-easy-crop pixel area. */

export type CropPixels = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("image_load_failed")));
    img.src = src;
  });
}

export async function cropImageToBlob(
  imageSrc: string,
  crop: CropPixels,
  opts: { size?: number; mime?: "image/jpeg" | "image/webp"; quality?: number } = {},
): Promise<Blob> {
  const size = opts.size ?? 512;
  const mime = opts.mime ?? "image/jpeg";
  const quality = opts.quality ?? 0.9;
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    size,
    size,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode_failed"))),
      mime,
      quality,
    );
  });
}
