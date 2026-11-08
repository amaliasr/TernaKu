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
  private entries = new Map<string, { promise: Promise<Blob>; bytes: number }>();
  private generation = 0;
  constructor(private readonly capacity = 8, private readonly byteLimit = 4 * 1024 * 1024) {}

  private trim(): void {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (this.entries.size > this.capacity || bytes > this.byteLimit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }

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
      return existing.promise;
    }
    const generation = this.generation;
    const promise = Promise.resolve().then(fetchBlob).then((blob) => {
      if (generation !== this.generation) throw new Error("Sesi berubah. Buka kembali foto setelah masuk.");
      const entry = this.entries.get(key);
      if (entry?.promise === promise) {
        entry.bytes = blob.size;
        this.trim();
      }
      return blob;
    }).catch((error) => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { promise, bytes: 0 });
    this.trim();
    return promise;
  }
}
