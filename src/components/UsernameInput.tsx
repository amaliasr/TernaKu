import type { InputHTMLAttributes } from "react";

export const usernameHint =
  "3–32 huruf, angka, titik, _ atau -. Awali dengan huruf atau angka.";
export const optionalUsernameHint =
  `${usernameHint} Jika kosong, username dibuat dari email.`;

/** Reuse the same keyboard and validation for every account form. */
export default function UsernameInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="form-control"
      type="text"
      autoComplete="username"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      minLength={3}
      maxLength={32}
      pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}"
      title={usernameHint}
      placeholder="Contoh: sari01"
      {...props}
    />
  );
}
