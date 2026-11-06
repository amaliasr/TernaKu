import type { CommandPayload } from "./types";

export type DraftKind = "sale" | "production";
export interface DraftAttempt {
  user_id: string;
  request_id: string;
  action: "sale.create" | "production.create";
  payload: CommandPayload;
  total: number | null;
  previous_sale_ids?: string[];
}
export interface EntryDraft {
  key: string;
  id: string;
  rev: number;
  updatedAt: number;
  fields: Record<string, unknown>;
  attempt: DraftAttempt | null;
}
export const draftKey = (mode: string, userId: string, kind: DraftKind) =>
  JSON.stringify([mode, userId, kind]);

const conflict = "Draf berubah di tab lain. Tutup formulir ini dan buka lagi untuk memakai draf terbaru.";
export function checkDraftVersion(current: EntryDraft | undefined, id: string, rev: number) {
  if (current ? current.id !== id || current.rev !== rev : rev !== 0) throw new Error(conflict);
}
let connection: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("ternaku-entry-drafts-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("drafts", { keyPath: "key" });
    open.onsuccess = () => {
      open.result.onversionchange = () => { open.result.close(); connection = undefined; };
      resolve(open.result);
    };
    open.onerror = () => reject(open.error);
  }).catch((e) => { connection = undefined; throw e; });
  return connection;
}
export async function readDraft(key: string): Promise<EntryDraft | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("drafts", "readonly");
    const get = tx.objectStore("drafts").get(key);
    tx.oncomplete = () => resolve(get.result);
    tx.onabort = () => reject(tx.error);
  });
}
/** Compare and write/delete in one transaction so a second tab cannot replay
 * an old draft using a new transaction ID. Resolve only after durable commit. */
export async function changeDraft(key: string, id: string, rev: number, next: EntryDraft | null) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    const get = store.get(key);
    let cause: unknown;
    get.onsuccess = () => {
      try {
        checkDraftVersion(get.result, id, rev);
        if (next) store.put({ ...next, rev: rev + 1 });
        else store.delete(key);
      } catch (e) { cause = e; tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(cause || tx.error);
  });
}

/** Serialize changes from this editor. The frozen attempt precedes the HTTP
 * request and survives a tab or PWA restart, including a lost response. */
export class DraftWriter {
  private tail: Promise<void> = Promise.resolve();
  private scheduled?: Promise<void>;
  private ended = false;
  constructor(public record: EntryDraft, private write = changeDraft) {}
  private queue(task: () => Promise<void>) {
    const done = this.tail.then(task, task);
    this.tail = done.catch(() => {});
    return done;
  }
  save() {
    if (this.ended) return Promise.resolve();
    if (this.scheduled) return this.scheduled;
    // Batch changes queued while the previous photo/fields are still being written.
    this.scheduled = this.queue(async () => {
      this.scheduled = undefined;
      const row = { ...this.record, updatedAt: Date.now(), fields: { ...this.record.fields } };
      await this.write(row.key, row.id, this.record.rev, row);
      this.record.rev++;
      this.record.updatedAt = row.updatedAt;
    });
    return this.scheduled;
  }
  async pending(attempt: DraftAttempt | null) {
    this.record.attempt = attempt;
    await this.save();
  }
  finish() {
    this.ended = true;
    const {key, id} = this.record;
    return this.queue(async () => {
      await this.write(key, id, this.record.rev, null);
    });
  }
}
