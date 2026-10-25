import type { MediaReference } from "./types";

export function mediaPath(reference: MediaReference): string {
  if (!["production", "sale", "profile"].includes(reference.kind)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(reference.id)
    || !/^[a-f0-9]{64}$/.test(reference.version))
    throw new Error("Alamat foto tidak valid.");
  return `/media/${reference.kind}/${reference.id}?v=${encodeURIComponent(reference.version)}`;
}

/** Session-local Blob cache, including in-flight deduplication. Never persists photos. */
export class MediaCache {
  private entries = new Map<string, Promise<Blob>>();
  private generation = 0;
  constructor(private readonly capacity = 12) {}

  clear(): void {
    this.generation += 1;
    this.entries.clear();
  }

  load(reference: MediaReference, fetchBlob: () => Promise<Blob>): Promise<Blob> {
    const key = mediaPath(reference);
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    const generation = this.generation;
    const promise = Promise.resolve().then(fetchBlob).then((blob) => {
      if (generation !== this.generation) throw new Error("Sesi berubah. Buka kembali foto setelah masuk.");
      return blob;
    }).catch((error) => {
      if (this.entries.get(key) === promise) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, promise);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return promise;
  }
}
