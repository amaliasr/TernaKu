import { ApiError } from "./request-errors";

function invalidResponse(status: number): Error {
  // Do not treat an HTML gateway rejection as a confirmed application failure.
  // The write may already be committed, so its original request ID must survive.
  return new Error(
    `Respons server belum dapat dibaca (HTTP ${status}). Silakan coba kembali.`,
  );
}

export async function readApiResponse<T>(response: Response): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch (cause) {
    if (response.status === 401)
      throw new ApiError("Sesi berakhir. Silakan masuk kembali.", 401);
    // A response can fail after headers arrive. Preserve these causes so the
    // request layer reports a timeout or interrupted connection, not bad JSON.
    if (
      cause instanceof TypeError ||
      (cause instanceof DOMException && cause.name === "AbortError")
    )
      throw cause;
    throw invalidResponse(response.status);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (response.status === 401)
      throw new ApiError("Sesi berakhir. Silakan masuk kembali.", 401);
    throw invalidResponse(response.status);
  }
  const json = value as { data?: T; error?: unknown };
  if (!response.ok || json.error)
    throw new ApiError(
      typeof json.error === "string"
        ? json.error
        : `Permintaan gagal (${response.status}).`,
      response.status,
    );
  if (json.data === undefined)
    throw new Error("Data respons API tidak lengkap.");
  return json.data;
}
