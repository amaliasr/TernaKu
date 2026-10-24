export function requestTimeout(path: string, body?: unknown): number {
  if (path === "/commands" && body && typeof body === "object") {
    const payload = (body as { payload?: unknown }).payload;
    if (payload && typeof payload === "object") {
      const photo = (payload as { photo?: unknown }).photo;
      if (typeof photo === "string" && photo.startsWith("data:image/"))
        return 90_000;
    }
  }
  return 60_000;
}
