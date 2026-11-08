import type { User } from "./types";

export const accountRoleLabel = (user: User): string => user.is_superadmin ? "Superadmin" : user.role === "admin" ? "Atasan" : "Karyawan";

/** Preserve all password characters; bcrypt accepts at most 72 UTF-8 bytes. */
export function validateNewPassword(password: unknown, confirmation: unknown): string {
  return validateAccountPassword(password,confirmation,12,true);
}

export function validateAccountPassword(password: unknown, confirmation: unknown, minimum = 10, required = false): string {
  if (typeof password !== "string" || Array.from(password).length < minimum || new TextEncoder().encode(password).length > 72 || password.includes("\0"))
    throw new Error(`Kata sandi minimal ${minimum} karakter dan maksimal 72 byte.`);
  if ((required || confirmation !== undefined) && (typeof confirmation !== "string" || password !== confirmation))
    throw new Error("Konfirmasi kata sandi tidak sama.");
  return password;
}
