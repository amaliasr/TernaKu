const MAX_UPLOAD_BYTES = 1024 * 1024;

/** Resize camera photos before sending; drawing to canvas also removes GPS/EXIF metadata. */
export async function preparePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024) {
    throw new Error("Pilih foto berukuran maksimal 25 MB.");
  }
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    try { await image.decode(); } catch { throw new Error("Foto belum dapat dibaca. Gunakan kamera atau pilih foto JPG, PNG, atau WebP."); }
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Perangkat belum bisa mengolah foto. Coba browser lain.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.75, 0.62, 0.48]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_UPLOAD_BYTES) {
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Foto belum dapat disimpan. Coba kembali."));
          reader.readAsDataURL(blob);
        });
      }
    }
    throw new Error("Foto masih terlalu besar. Coba foto ulang dari jarak yang sesuai.");
  } finally { URL.revokeObjectURL(source); }
}
