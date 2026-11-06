export const MAX_PHOTO_BYTES = 1024 * 1024;
export const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;
const READ_ERROR = "Foto belum dapat dibaca. Gunakan kamera atau pilih foto JPG, PNG, atau WebP.";
const limits = {
  documentation: { longestEdge: 1920, targetBytes: 320 * 1024 },
  profile: { longestEdge: 640, targetBytes: 96 * 1024 },
};
export type PhotoPurpose = keyof typeof limits;

/** Only these raster formats may be retained without re-encoding. */
export function rasterMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function photoDimensions(width: number, height: number, longestEdge = limits.documentation.longestEdge) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error(READ_ERROR);
  const ratio = Math.min(1, longestEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

type Encoder = (width: number, height: number, quality: number) => Promise<Blob | null>;

/** Resize before encoding. Most camera photos need only one pass. */
export async function compressPhoto(width: number, height: number, encode: Encoder, purpose: PhotoPurpose = "documentation"): Promise<Blob> {
  const { longestEdge, targetBytes } = limits[purpose];
  let edge = Math.min(longestEdge, Math.max(width, height));
  for (let attempt = 1; attempt <= 4; attempt++) {
    const size = photoDimensions(width, height, edge);
    const blob = await encode(size.width, size.height, 0.85);
    if (!blob || !blob.size) throw new Error("Perangkat belum bisa mengolah foto. Coba browser lain.");
    if (blob.size <= targetBytes) return blob;
    if (attempt === 4 || edge <= 1) {
      if (blob.size <= MAX_PHOTO_BYTES) return blob;
      break;
    }
    // Estimate the next pixel count from the actual encoding instead of trying many JPEG qualities.
    const scale = Math.min(0.9, Math.sqrt(targetBytes / blob.size) * 0.94);
    edge = Math.max(1, Math.floor(edge * scale));
  }
  throw new Error("Foto belum bisa diperkecil hingga 1 MB. Coba pilih foto lain.");
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Foto belum dapat disimpan. Coba kembali."));
    reader.readAsDataURL(blob);
  });
}

export async function preparePhoto(file: File, purpose: PhotoPurpose = "documentation"): Promise<string> {
  if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error("Foto sumber maksimal 25 MB. Pilih foto lain atau ambil ulang.");
  if (!file.size || !file.type.startsWith("image/") || file.type === "image/svg+xml") throw new Error(READ_ERROR);
  const mime = rasterMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    try { await image.decode(); } catch { throw new Error(READ_ERROR); }
    photoDimensions(image.naturalWidth, image.naturalHeight);
    // Small supported images keep their original pixels and encoding quality.
    if (mime && file.size <= limits[purpose].targetBytes) return await dataUrl(file.slice(0, file.size, mime));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Perangkat belum bisa mengolah foto. Coba browser lain.");
    const outputMime = mime === "image/jpeg" ? "image/jpeg" : "image/webp";
    let blob: Blob;
    try {
      blob = await compressPhoto(image.naturalWidth, image.naturalHeight, (width, height, quality) => {
        canvas.width = width;
        canvas.height = height;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, width, height);
        return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, outputMime, quality));
      }, purpose);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    if (mime && file.size <= blob.size) return await dataUrl(file.slice(0, file.size, mime));
    return await dataUrl(blob);
  } finally {
    URL.revokeObjectURL(source);
  }
}
