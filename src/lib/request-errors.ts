export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A transport failure cannot tell us whether the server committed a write. */
export function isUncertainWriteError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return !(error.status >= 400 && error.status < 500 && error.status !== 408);
}

/** A later auth/route/rate-limit denial says nothing about the original save.
 * Only application validation after idempotency lookup can release its payload. */
export function shouldPreserveUnconfirmedWrite(error: unknown): boolean {
  return !(error instanceof ApiError && [400, 409, 422].includes(error.status));
}
