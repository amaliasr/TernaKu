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

/** Sensitive command fingerprints are confined to the current authenticated page. */
export function rememberCommandRequest(fingerprint: string, sensitive: boolean, memory: Map<string,string>, storage: Pick<Storage,"getItem"|"setItem">, key: string, createId: () => string): string {
  if (sensitive) {
    const id = memory.get(fingerprint) || createId();
    memory.set(fingerprint,id);
    return id;
  }
  const ids = readPendingRequestIds(storage.getItem(key));
  const id = ids[fingerprint] || createId();
  ids[fingerprint] = id;
  storage.setItem(key,JSON.stringify(ids));
  return id;
}
