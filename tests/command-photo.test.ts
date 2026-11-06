import assert from "node:assert/strict";
import test from "node:test";
import { commandPhotoForm } from "../src/lib/command-photo";

test("photo requests preserve the exact command and original bytes through multipart", async () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0, 0x2b, 0xf0]);
  const photo = "data:image/jpeg;base64," + Buffer.from(bytes).toString("base64");
  const command = {
    action: "sale.create",
    payload: { customer: "Pembeli", photo, stock_source: "warehouse" },
    request_id: "same-sale-123",
    response_mode: "compact",
    receipt_for_role: "employee",
  };
  const form = commandPhotoForm(command);
  assert.ok(form);
  const request = new Request("https://example.invalid/commands", { method: "POST", body: form });
  const wire = await request.formData();
  const file = wire.get("photo");
  assert.ok(file instanceof Blob);
  assert.equal(file.type, "image/jpeg");
  const raw = new Uint8Array(await file.arrayBuffer());
  assert.deepEqual(raw, bytes);
  const metadata = JSON.parse(String(wire.get("command")));
  assert.equal(metadata.payload.photo, "");
  metadata.payload.photo = "data:" + file.type + ";base64," + Buffer.from(raw).toString("base64");
  assert.equal(JSON.stringify(metadata), JSON.stringify(command));
});

test("unmodified, empty and unreadable photos stay on the ordinary JSON validation path", () => {
  for (const photo of [undefined, "", "some URL", ...["%%%%", "YQ", "YR==", "Y  Q=="].map(encoded => "data:image/png;base64," + encoded)]) {
    assert.equal(commandPhotoForm({ payload: { photo } }), undefined);
  }
});
