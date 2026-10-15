/** Do not reset damaged retry data: it may contain the ID of a committed write. */
export function readPendingRequestIds(raw: string | null): Record<string, string> {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "Data percobaan penyimpanan di perangkat tidak dapat dibaca. Hubungi admin untuk memeriksa riwayat sebelum mencoba transaksi baru.",
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some(
      (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(id),
    )
  ) {
    throw new Error(
      "Data percobaan penyimpanan di perangkat tidak valid. Hubungi admin untuk memeriksa riwayat sebelum mencoba transaksi baru.",
    );
  }
  return value as Record<string, string>;
}
