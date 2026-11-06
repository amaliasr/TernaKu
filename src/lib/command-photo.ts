import type { CommandPayload } from "./types";

/** Drafts keep their data URL. Send the image bytes only once when saving. */
export function commandPhotoForm(command: { payload: CommandPayload }): FormData | undefined {
  const photo = command.payload.photo;
  if (typeof photo !== "string" || !photo) return;
  const header = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(photo);
  if (!header) return;

  const encoded = photo.slice(header[0].length);
  if (!encoded || encoded.length % 4 !== 0 || /\s/.test(encoded)) return;
  let binary: string;
  try {
    // PHP fingerprints canonical base64, including the padding bits of the final quartet.
    const tail = encoded.slice(-4);
    if (btoa(atob(tail)) !== tail) return;
    binary = atob(encoded);
  } catch {
    // Leave malformed drafts to the usual API validation; never send a command without its photo.
    return;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const form = new FormData();
  // Keep photo in its original field position so a JSON retry has the same fingerprint.
  form.set("command", JSON.stringify({ ...command, payload: { ...command.payload, photo: "" } }));
  form.set("photo", new Blob([bytes], { type: header[1] }), "photo");
  return form;
}
