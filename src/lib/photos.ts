export const MAX_PHOTO_BYTES = 1024 * 1024;
export const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;
const READ_ERROR = "Foto belum dapat dibaca. Gunakan kamera atau pilih foto JPG, PNG, atau WebP.";

/** Only these raster formats may be retained without re-encoding. */
export function rasterMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function photoDimensions(width: number, height: number, scale = 1) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error(READ_ERROR);
  // Bound canvas memory on phones; do not enlarge the source image.
  const ratio = Math.min(1, scale, 8192 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

type Encoder = (width: number, height: number, quality: number) => Promise<Blob | null>;

/** Keep resolution while good-quality encoding fits, then reduce dimensions adaptively. */
export async function compressPhoto(width: number, height: number, encode: Encoder, maxBytes = MAX_PHOTO_BYTES): Promise<Blob> {
  let size = photoDimensions(width, height);
  for (let attempt = 0; attempt < 16; attempt++) {
    const best = await encode(size.width, size.height, 1);
    if (!best || !best.size) throw new Error("Perangkat belum bisa mengolah foto. Coba browser lain.");
    if (best.size <= maxBytes) return best;
    let low = 0.82;
    let high = 1;
    let candidate = await encode(size.width, size.height, low);
    if (!candidate || !candidate.size) throw new Error("Foto belum dapat diproses. Coba pilih foto lain.");
    if (candidate.size <= maxBytes) {
      // Search for the highest quality that actually satisfies the byte limit.
      for (let step = 0; step < 7; step++) {
        const quality = (low + high) / 2;
        const trial = await encode(size.width, size.height, quality);
        if (!trial || !trial.size) throw new Error("Foto belum dapat diproses. Coba pilih foto lain.");
        if (trial.size <= maxBytes) { low = quality; candidate = trial; }
        else high = quality;
      }
      return candidate;
    }
    const ratio = Math.max(0.5, Math.min(0.9, Math.sqrt(maxBytes / candidate.size) * 0.94));
    const next = photoDimensions(size.width, size.height, ratio);
    if (next.width === size.width && next.height === size.height) break;
    size = next;
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

export async function preparePhoto(file: File): Promise<string> {
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
    if (mime && file.size <= MAX_PHOTO_BYTES) return await dataUrl(file.slice(0, file.size, mime));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Perangkat belum bisa mengolah foto. Coba browser lain.");
    const outputMime = mime === "image/jpeg" ? "image/jpeg" : "image/webp";
    let lastWidth = 0;
    let lastHeight = 0;
    const blob = await compressPhoto(image.naturalWidth, image.naturalHeight, async (width, height, quality) => {
      if (width !== lastWidth || height !== lastHeight) {
        canvas.width = width;
        canvas.height = height;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, width, height);
        lastWidth = width; lastHeight = height;
      }
      return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, outputMime, quality));
    });
    canvas.width = 0; canvas.height = 0;
    return await dataUrl(blob);
  } finally { URL.revokeObjectURL(source); }
}
