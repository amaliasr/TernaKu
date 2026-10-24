import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readApiResponse } from "../src/lib/api-response";
import { requestTimeout } from "../src/lib/request-timeout";
import { isExpiredSession } from "../src/lib/auth-session";
import {
  ApiError,
  isUncertainWriteError,
  shouldPreserveUnconfirmedWrite,
} from "../src/lib/request-errors";

test("valid JSON envelopes retain data and application validation errors", async () => {
  for (const data of [{ saved: true }, false, 0, null]) {
    assert.deepEqual(await readApiResponse(Response.json({ data })), data);
  }
  await assert.rejects(
    readApiResponse(Response.json({ error: "Nama wajib diisi." }, { status: 422 })),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.equal(error.message, "Nama wajib diisi.");
      assert.equal(isUncertainWriteError(error), false);
      return true;
    },
  );
});

test("aborting an HTTP response after headers preserves its timeout cause", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"data":');
    // Keep the real HTTP body open until the client aborts it.
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}`, {
    signal: controller.signal,
  });
  const reading = readApiResponse(response);
  controller.abort();
  await assert.rejects(reading, (error: unknown) => {
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "AbortError");
    assert.equal(isExpiredSession(error), false);
    assert.equal(isUncertainWriteError(error), true);
    assert.equal(shouldPreserveUnconfirmedWrite(error), true);
    return true;
  });
});

test("an interrupted response stream preserves the connection error", async () => {
  const interruption = new TypeError("Response stream disconnected");
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":'));
      controller.error(interruption);
    },
  }));
  await assert.rejects(readApiResponse(response), (error: unknown) => {
    assert.equal(error, interruption);
    assert.equal(isExpiredSession(error), false);
    assert.equal(shouldPreserveUnconfirmedWrite(error), true);
    return true;
  });
});

test("a truncated JSON body reports HTTP status without losing uncertain-write protection", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":{"private":"do-not-display"'));
      controller.close();
    },
  }), { status: 200 });
  await assert.rejects(readApiResponse(response), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error instanceof ApiError, false);
    assert.match(error.message, /HTTP 200/);
    assert.doesNotMatch(error.message, /private|do-not-display/);
    assert.equal(isUncertainWriteError(error), true);
    assert.equal(shouldPreserveUnconfirmedWrite(error), true);
    return true;
  });
});

test("HTML gateway errors show status without exposing HTML or confirming failed writes", async () => {
  for (const status of [403, 413, 502, 503, 504]) {
    await assert.rejects(
      readApiResponse(new Response("<html>private hosting error</html>", { status })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.doesNotMatch(error.message, /html|private hosting error/);
        assert.equal(isExpiredSession(error), false);
        assert.equal(isUncertainWriteError(error), true);
        assert.equal(shouldPreserveUnconfirmedWrite(error), true);
        return true;
      },
    );
  }
});

test("HTTP 401 still invalidates the session even when its response cannot be read", async () => {
  const interruptedBody = new ReadableStream({
    start(controller) {
      controller.error(new DOMException("Response aborted", "AbortError"));
    },
  });
  for (const body of ["<html>Unauthorized</html>", "null", interruptedBody]) {
    await assert.rejects(
      readApiResponse(new Response(body, { status: 401 })),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 401);
        assert.equal(isExpiredSession(error), true);
        assert.equal(shouldPreserveUnconfirmedWrite(error), true);
        return true;
      },
    );
  }
});

test("invalid envelope shapes remain response errors rather than connection errors", async () => {
  for (const value of [null, [], "Unexpected page", 123]) {
    await assert.rejects(readApiResponse(Response.json(value)), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof TypeError, false);
      assert.match(error.message, /HTTP 200/);
      assert.equal(shouldPreserveUnconfirmedWrite(error), true);
      return true;
    });
  }
});

test("photo commands allow extra time without extending ordinary reads or photo removal", () => {
  assert.equal(requestTimeout("/commands", {
    action: "profile.update",
    payload: { name: "Sari", photo: "data:image/jpeg;base64,/9j/" },
  }), 90_000);
  for (const [path, body] of [
    ["/bootstrap", undefined],
    ["/commands", { action: "profile.update", payload: { name: "Sari" } }],
    ["/commands", { action: "profile.update", payload: { name: "Sari", photo: "" } }],
    ["/auth/login", { email: "sari@example.test", password: "test" }],
  ] as const) {
    assert.equal(requestTimeout(path, body), 60_000);
  }
});
