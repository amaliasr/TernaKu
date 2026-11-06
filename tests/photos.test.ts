import test from "node:test";
import assert from "node:assert/strict";
import { compressPhoto, MAX_PHOTO_BYTES, photoDimensions, preparePhoto, rasterMime } from "../src/lib/photos";

test("only recognizable JPEG, PNG and WebP bytes qualify for original preservation", () => {
  assert.equal(rasterMime(Uint8Array.from([255, 216, 255, 224])), "image/jpeg");
  assert.equal(rasterMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), "image/png");
  assert.equal(rasterMime(Uint8Array.from(Buffer.from("RIFFxxxxWEBP"))), "image/webp");
  assert.equal(rasterMime(Uint8Array.from(Buffer.from("<svg>image</svg>"))), null);
  assert.equal(rasterMime(new Uint8Array()), null);
  assert.equal(rasterMime(Uint8Array.from([137, 80, 78, 71])), null);
});

test("dimensions retain source aspect ratio and never enlarge photos", () => {
  assert.deepEqual(photoDimensions(900, 600), { width: 900, height: 600 });
  const size = photoDimensions(12000, 9000);
  assert.deepEqual(size, { width: 1920, height: 1440 });
  assert.ok(Math.abs(size.width / size.height - 4 / 3) < 0.001);
  const tall = photoDimensions(200, 20000);
  assert.equal(tall.height, 1920);
  assert.throws(() => photoDimensions(0, 100));
  assert.throws(() => photoDimensions(Number.NaN, 100));
});

test("a camera shot is resized before encoding and stops as soon as it fits the upload target", async () => {
  const blob = new Blob([new Uint8Array(300 * 1024)]);
  let calls = 0;
  const result = await compressPhoto(4000, 3000, async (width, height, quality) => {
    calls++;
    assert.deepEqual([width, height], [1920, 1440]);
    assert.ok(quality >= 0.82);
    return blob;
  });
  assert.equal(result, blob);
  assert.equal(calls, 1);
});

test("profile photos target a smaller size and preserve the original aspect ratio", async () => {
  const sizes: number[][] = [];
  const result = await compressPhoto(1500, 2000, async (width, height) => {
    sizes.push([width, height]);
    return new Blob([new Uint8Array(Math.ceil(width * height / 2))]);
  }, "profile");
  assert.deepEqual(sizes[0], [480, 640]);
  assert.equal(sizes.length, 2);
  assert.ok(result.size <= 96 * 1024);
});

test("oversized camera images resize adaptively with aspect ratio and good quality preserved", async () => {
  const attempts: { width: number; height: number; quality: number }[] = [];
  const result = await compressPhoto(6000, 4000, async (width, height, quality) => {
    attempts.push({ width, height, quality });
    return new Blob([new Uint8Array(Math.ceil(width * height * quality * 0.2))]);
  });
  assert.ok(result.size <= 320 * 1024);
  assert.ok(attempts.length <= 3);
  assert.ok(attempts.some(attempt => attempt.width < attempts[0].width));
  assert.ok(attempts.every(attempt => Math.abs(attempt.width / attempt.height - 1.5) < 0.002));
  assert.ok(attempts.every(attempt => attempt.quality >= 0.82));
});

test("failed or stubborn encoders never return an oversized or empty image", async () => {
  await assert.rejects(compressPhoto(100, 100, async () => null), /mengolah/);
  await assert.rejects(compressPhoto(100, 100, async () => new Blob()), /mengolah/);
  await assert.rejects(compressPhoto(2, 2, async () => new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)])), /1 MB/);
});

test("a decoded small raster keeps original bytes; oversized and unreadable sources never pass through", async () => {
  const keys = ["Image", "FileReader", "document"] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  let failDecode = false;
  let encodes = 0;
  class TestImage {
    src = "";
    naturalWidth = 4000;
    naturalHeight = 3000;
    async decode() { if (failDecode) throw new Error("invalid image"); }
  }
  class TestReader {
    result = "";
    onload?: () => void;
    async readAsDataURL(blob: Blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
      this.onload?.();
    }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  Object.defineProperty(globalThis, "FileReader", { configurable: true, value: TestReader });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement(tag: string) {
      assert.equal(tag, "canvas");
      return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob(callback: (blob: Blob) => void, mime: string) {
        encodes++;
        callback(new Blob([new Uint8Array(80_000)], { type: mime }));
      } };
    },
  } });
  try {
    const bytes = Uint8Array.from([255, 216, 255, 224, 1, 2, 3, 4, 5]);
    const small = await preparePhoto(new File([bytes], "foto.jpg", { type: "image/jpeg" }));
    assert.equal(small, `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`);
    assert.equal(encodes, 0, "small images must not lose quality through a canvas re-encode");
    const largeBytes = new Uint8Array(MAX_PHOTO_BYTES + 1);
    largeBytes.set(bytes);
    const large = await preparePhoto(new File([largeBytes], "kamera.jpg", { type: "image/jpeg" }));
    assert.equal(Buffer.from(large.split(",")[1], "base64").length, 80_000);
    const medium = await preparePhoto(new File([largeBytes.subarray(0, 600_000)], "kamera.jpg", { type: "image/jpeg" }));
    assert.equal(Buffer.from(medium.split(",")[1], "base64").length, 80_000);
    assert.equal(encodes, 2, "even images below 1 MiB benefit from the smaller transfer target");
    failDecode = true;
    await assert.rejects(preparePhoto(new File([bytes], "rusak.jpg", { type: "image/jpeg" })), /belum dapat dibaca/);
    await assert.rejects(preparePhoto(new File(["<svg/>"], "foto.svg", { type: "image/svg+xml" })), /belum dapat dibaca/);
  } finally {
    keys.forEach((key, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
