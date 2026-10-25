"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { preparePhoto } from "@/lib/photos";
import ImagePreview from "./ImagePreview";
import styles from "./PhotoUpload.module.css";
import type { MediaReference } from "@/lib/types";

type PhotoUploadProps = {
  onChange: (value: string) => void;
  value?: string;
  defaultValue?: string;
  photoRef?: MediaReference;
  label?: string;
  disabled?: boolean;
  optional?: boolean;
  capture?: "user" | "environment";
  onBusyChange?: (busy: boolean) => void;
};

export default function PhotoUpload({ onChange, value, defaultValue = "", photoRef, label = "Foto dokumentasi", disabled = false, optional = true, capture = "environment", onBusyChange }: PhotoUploadProps) {
  const id = useId();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(defaultValue);
  const preview = value ?? localValue;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => () => { generation.current++; busyCallback.current?.(false); }, []);

  function change(photo: string) { setLocalValue(photo); onChange(photo); }
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || disabled || busy) return;
    const current = ++generation.current;
    setBusy(true); setError("");
    busyCallback.current?.(true);
    input.setCustomValidity("Tunggu sampai foto selesai diproses sebelum menyimpan.");
    try {
      const photo = await preparePhoto(file);
      if (current === generation.current) change(photo);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Foto belum dapat dibaca.");
    } finally {
      input.setCustomValidity(""); input.value = "";
      if (current === generation.current) { setBusy(false); busyCallback.current?.(false); }
    }
  }
  return <div className={styles.upload} role="group" aria-labelledby={`${id}-label`} aria-busy={busy}>
    <span id={`${id}-label`} className="form-label">{label} <small>({optional ? "opsional" : "wajib"})</small></span>
    <div className={styles.buttons}>
      <button type="button" className="btn btn-primary" disabled={busy || disabled} onClick={() => camera.current?.click()}><Camera size={20} /> Ambil foto</button>
      <button type="button" className="btn btn-light" disabled={busy || disabled} onClick={() => gallery.current?.click()}><ImagePlus size={20} /> Pilih dari galeri</button>
    </div>
    <input ref={camera} className="visually-hidden" type="file" accept="image/*" capture={capture} disabled={disabled} aria-label={`${label}: ambil foto`} aria-describedby={`${id}-help`} onChange={(event) => void select(event)} />
    <input ref={gallery} className="visually-hidden" type="file" accept="image/*" disabled={disabled} aria-label={`${label}: pilih dari galeri`} aria-describedby={`${id}-help`} onChange={(event) => void select(event)} />
    <small id={`${id}-help`} className="text-muted">Foto besar disesuaikan otomatis hingga maksimal 1 MB. Foto yang sudah kecil dipertahankan bila sesuai. Foto sumber maksimal 25 MB.</small>
    {busy && <p role="status">Memproses foto…</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {(preview || photoRef) && <div className={styles.preview}><ImagePreview src={preview} photoRef={photoRef} alt={label} /><button type="button" className="btn btn-light" disabled={busy || disabled} onClick={() => { change(""); setError(""); }}><X size={18} /> Hapus foto</button></div>}
  </div>;
}
