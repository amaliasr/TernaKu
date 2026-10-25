type SavedCredential = string | { hash: string; saltEmail: string };
export type DemoCredentials = Record<string, SavedCredential>;

const normalized = (email: string) => email.trim().toLowerCase();
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function parseDemoCredentials(raw: string | null): DemoCredentials {
  const parsed: unknown = JSON.parse(raw || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Data akun demo tidak dapat dibaca.");
  for (const value of Object.values(parsed)) {
    if (isHash(value)) continue;
    if (value && typeof value === "object" && !Array.isArray(value) &&
        isHash(value.hash) && typeof value.saltEmail === "string" && value.saltEmail.trim()) continue;
    throw new Error("Data akun demo tidak dapat dibaca.");
  }
  return parsed as DemoCredentials;
}

/** Keep the original email salt: moving only the hash would invalidate the password. */
export function renameDemoCredential(credentials: DemoCredentials, oldEmail: string, newEmail: string): DemoCredentials {
  const from = normalized(oldEmail);
  const to = normalized(newEmail);
  const next = { ...credentials };
  if (from === to) return next;
  const original = Object.hasOwn(credentials, from) ? credentials[from] : undefined;
  delete next[from];
  delete next[to];
  if (original) next[to] = typeof original === "string" ? { hash: original, saltEmail: from } : { ...original };
  return next;
}

export async function demoPasswordMatches(
  credentials: DemoCredentials,
  email: string,
  password: string,
  seedPassword: string | null,
  hashPassword: (email: string, password: string) => Promise<string>,
): Promise<boolean> {
  const key = normalized(email);
  if (!Object.hasOwn(credentials, key)) return seedPassword !== null && password === seedPassword;
  const credential = credentials[key];
  const { hash, saltEmail } = typeof credential === "string" ? { hash: credential, saltEmail: key } : credential;
  return hash === await hashPassword(saltEmail, password);
}

/** A quota failure must not leave the login email out of step with the user record. */
export function persistDemoData(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  stateKey: string,
  state: unknown,
  credentialKey: string,
  credentials?: DemoCredentials,
): void {
  const stateJson = JSON.stringify(state);
  if (credentials === undefined) {
    storage.setItem(stateKey, stateJson);
    return;
  }
  const credentialJson = JSON.stringify(credentials);
  const previous = storage.getItem(credentialKey);
  storage.setItem(credentialKey, credentialJson);
  try {
    storage.setItem(stateKey, stateJson);
  } catch (cause) {
    if (previous === null) storage.removeItem(credentialKey);
    else storage.setItem(credentialKey, previous);
    throw cause;
  }
}
