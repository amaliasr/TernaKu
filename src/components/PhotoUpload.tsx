"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { preparePhoto } from "@/lib/photos";
import styles from "./PhotoUpload.module.css";

export default function PhotoUpload({ onChange, label = "Foto dokumentasi" }: { onChange: (value: string) => void; label?: string }) {
  const id = useId();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    input.setCustomValidity("Tunggu sampai foto selesai diproses sebelum menyimpan.");
    try {
      const photo = await preparePhoto(file);
      setPreview(photo); onChange(photo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Foto belum dapat dibaca.");
    } finally {
      input.setCustomValidity(""); input.value = ""; setBusy(false);
    }
  }
  return <div className={styles.upload} role="group" aria-labelledby={`${id}-label`} aria-busy={busy}>
    <span id={`${id}-label`} className="form-label">{label} <small>(opsional)</small></span>
    <div className={styles.buttons}>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => camera.current?.click()}><Camera size={20} /> Ambil foto</button>
      <button type="button" className="btn btn-light" disabled={busy} onClick={() => gallery.current?.click()}><ImagePlus size={20} /> Pilih dari galeri</button>
    </div>
    <input ref={camera} className="visually-hidden" type="file" accept="image/*" capture="environment" aria-label={`${label}: ambil foto`} onChange={(event) => void select(event)} />
    <input ref={gallery} className="visually-hidden" type="file" accept="image/*" aria-label={`${label}: pilih dari galeri`} onChange={(event) => void select(event)} />
    <small className="text-muted">Foto dari kamera akan diperkecil otomatis. Pilihan kamera mengikuti dukungan perangkat.</small>
    {busy && <p role="status">Memproses foto…</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {preview && <div className={styles.preview}><img src={preview} alt={`Pratinjau ${label.toLowerCase()}`} /><button type="button" className="btn btn-light" disabled={busy} onClick={() => { setPreview(""); onChange(""); setError(""); }}><X size={18} /> Hapus foto</button></div>}
  </div>;
}
