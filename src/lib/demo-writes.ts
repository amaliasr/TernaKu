import { accountAccessError, executeCommand } from "./domain";
import { ApiError } from "./request-errors";
import type { CommandPayload, State } from "./types";

/** All demo state writers read the latest localStorage value inside this lock.
 * On browsers without Web Locks, a read/write IndexedDB transaction provides
 * the same cross-tab exclusion. The critical section is always synchronous. */
export function withDemoWriteLock<T>(write: () => T): Promise<T> {
  if (navigator.locks) return navigator.locks.request("ternaku.demo.v1", write);
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("ternaku-demo-lock", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("lock");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      let tx: IDBTransaction;
      try { tx = db.transaction("lock", "readwrite"); }
      catch (error) { db.close(); reject(error); return; }
      let result: T;
      let failure: unknown;
      tx.objectStore("lock").get("state").onsuccess = () => {
        try { result = write(); } catch (e) { failure = e; tx.abort(); }
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(failure ?? tx.error); };
    };
  });
}

export function applyDemoWrite(source: State, userId: string, action: string, payload: CommandPayload,
  attempt?: { request_id: string; fingerprint: string }, now?: Date,
): { state: State; result?: State["command_result"] } {
  const user = source.users.find(row => row.id === userId);
  if (!user || accountAccessError(user)) throw new ApiError("Akun ini belum dapat digunakan.", 403);
  if (action === "stock.reconcile" && user.role !== "admin")
    throw new ApiError("Penyesuaian stok hanya dapat dilakukan oleh admin.", 403);
  if (attempt) {
    const earlier = source.activity.find(row => row.user_id === userId && row.demo_write?.request_id === attempt.request_id);
    if (earlier?.demo_write) {
      if (earlier.action !== action || earlier.demo_write.fingerprint !== attempt.fingerprint)
        throw new ApiError("ID penyimpanan sudah dipakai untuk data yang berbeda.", 409);
      return { state: source, result: { action, record_id: earlier.demo_write.record_id, request_id: attempt.request_id } };
    }
  }
  let next: State;
  try { next = executeCommand(source, userId, action, payload, now); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    // Domain validation runs before any local write, so the form can be edited.
    throw new ApiError(error instanceof Error ? error.message : "Periksa isian dan coba lagi.", 422);
  }
  let recordId: string;
  if (action === "sale.create") recordId = next.sales[source.sales.length].id;
  else if (action === "production.create") recordId = next.productions[source.productions.length].id;
  else if (action === "price.create") recordId = next.prices[source.prices.length].id;
  else if (action === "stock.reconcile" && attempt)
    recordId = next.stock_movements![source.stock_movements?.length ?? 0].reference_id;
  else return { state: next };
  const result = { action, record_id: recordId, request_id: attempt?.request_id ?? "" };
  if (attempt) next.activity[0].demo_write = { ...attempt, record_id: recordId };
  return { state: next, result };
}
