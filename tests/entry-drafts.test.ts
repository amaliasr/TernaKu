import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftWriter, checkDraftVersion, draftKey, type EntryDraft, type DraftAttempt } from "../src/lib/entry-drafts";

const key = draftKey("live", "employee-a", "sale");
function empty(id: string): EntryDraft {
  return { key, id, rev: 0, updatedAt: 0, fields: {}, attempt: null };
}
function storage() {
  let saved: EntryDraft | undefined;
  const write = async (_key: string, id: string, rev: number, next: EntryDraft | null) => {
    checkDraftVersion(saved, id, rev);
    saved = next ? structuredClone({ ...next, rev: rev + 1 }) : undefined;
  };
  return { write, read: () => saved && structuredClone(saved) };
}
test("draf panen, penjualan, akun lain dan demo mempunyai tempat terpisah", () => {
  assert.equal(new Set([key, draftKey("live", "employee-b", "sale"), draftKey("demo", "employee-a", "sale"), draftKey("live", "employee-a", "production")]).size, 4);
});
test("draf menyimpan foto dan nomor percobaan sebelum pengiriman, termasuk saat dibuka ulang", async () => {
  const db = storage();
  const editor = new DraftWriter(empty("one"), db.write);
  editor.record.fields.customer = "Bu Sari";
  const first = editor.save();
  editor.record.fields.photo = "compressed-photo";
  const attempt: DraftAttempt = { action: "sale.create", user_id: "employee-a", request_id: "same-request", payload: { kg: 2 }, total: 56000 };
  await Promise.all([first, editor.pending(attempt)]);
  const restored = new DraftWriter(db.read()!, db.write);
  assert.deepEqual(restored.record.attempt, attempt);
  assert.deepEqual(restored.record.fields, { customer: "Bu Sari", photo: "compressed-photo" });
  await restored.pending(null);
  assert.equal(db.read()?.fields.customer, "Bu Sari");
  assert.equal(db.read()?.attempt, null);
  await restored.finish();
  await restored.save();
  assert.equal(db.read(), undefined);
});
test("tab lama tidak bisa mengubah atau menghidupkan kembali draf yang sudah dikirim", async () => {
  const db = storage();
  const a = new DraftWriter(empty("a"), db.write);
  const b = new DraftWriter(empty("b"), db.write);
  await a.save();
  await assert.rejects(b.save(), /tab lain/);
  const stale = new DraftWriter(db.read()!, db.write);
  a.record.fields.buyer = "Ibu Lina";
  await a.save();
  await assert.rejects(stale.finish(), /tab lain/);
  assert.equal(db.read()?.fields.buyer, "Ibu Lina");
  const reopened = new DraftWriter(db.read()!, db.write);
  await a.finish();
  await assert.rejects(reopened.save(), /tab lain/);
  assert.equal(db.read(), undefined);
});
