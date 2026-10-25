"use client";

import { useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  LogOut,
  Moon,
  Save,
  Sun,
  Type,
  UserRound,
  Warehouse,
} from "lucide-react";
import { useFarm } from "@/lib/store";
import { Dialog, Field, errorMessage } from "./ModuleUI";
import PhotoUpload from "./PhotoUpload";
import Avatar from "./Avatar";
import { useTheme, type FontSize } from "./ThemeProvider";
import styles from "./ProfileSettings.module.css";

export default function ProfileSettings({ onClose }: { onClose: () => void }) {
  const { user, command, logout } = useFarm();
  const { theme, setTheme, fontSize, setFontSize } = useTheme();
  const [name, setName] = useState(user?.name || "");
  const [photo, setPhoto] = useState(user?.photo || "");
  const [photoChanged, setPhotoChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (!user) return null;
  const changed = name.trim() !== user.name || photoChanged;
  const saving = busy || settingsBusy;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || photoBusy) return;
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const confirmed = await command("profile.update", {
        name: name.trim(),
        ...(photoChanged ? { photo } : {}),
      });
      setName(name.trim());
      setPhoto(confirmed.users.find(row => row.id === user?.id)?.photo || "");
      setPhotoChanged(false);
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (saving) return;
    setBusy(true);
    setError("");
    try {
      await logout();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  const sizes: { value: FontSize; label: string }[] = [
    { value: "small", label: "Kecil" },
    { value: "normal", label: "Normal" },
    { value: "large", label: "Besar" },
  ];
  return (
    <Dialog
      title="Profil & tampilan"
      subtitle="Atur identitas dan kenyamanan membaca Anda."
      onClose={() => {
        if (saving) return false;
        onClose();
      }}
    >
      <div className={styles.content}>
        <div className={styles.identity}>
          <Avatar user={{ name: name || user.name, photo, photo_ref: photoChanged ? undefined : user.photo_ref }} size="lg" />
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <small>
              {user.role === "admin" ? "Atasan / admin" : "Karyawan"}
            </small>
          </div>
        </div>
        <form onSubmit={save}>
          <fieldset disabled={saving} className={styles.profileFields}>
            <h3>
              <UserRound size={20} /> Profil saya
            </h3>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            {saved && (
              <div className={styles.success} role="status">
                <CheckCircle2 size={20} /> Profil berhasil diperbarui.
              </div>
            )}
            <Field label="Nama lengkap">
              <input
                className="form-control"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                autoComplete="name"
                maxLength={120}
                required
              />
            </Field>
            <PhotoUpload
              value={photo}
              photoRef={photoChanged ? undefined : user.photo_ref}
              onChange={(value) => {
                setPhoto(value);
                setPhotoChanged(true);
                setSaved(false);
              }}
              onBusyChange={setPhotoBusy}
              label="Foto profil"
              capture="user"
              disabled={saving}
            />
            <button
              className="btn btn-primary"
              type="submit"
              disabled={saving || photoBusy || !changed}
            >
              <Save size={19} />
              {busy
                ? "Menyimpan…"
                : photoBusy
                  ? "Memproses foto…"
                  : "Simpan profil"}
            </button>
          </fieldset>
        </form>
        {user.role === "admin" && <HarvestSettings disabled={busy} onBusyChange={setSettingsBusy} />}
        <section
          className={styles.preferences}
          aria-label="Pengaturan tampilan"
        >
          <h3>
            <Type size={20} /> Tampilan
          </h3>
          <p>
            Pilihan ini langsung diterapkan dan disimpan pada perangkat ini.
          </p>
          <fieldset className={styles.options}>
            <legend>Ukuran tulisan</legend>
            <div className={styles.fontOptions}>
              {sizes.map((size) => (
                <button
                  type="button"
                  key={size.value}
                  className={fontSize === size.value ? styles.selected : ""}
                  aria-pressed={fontSize === size.value}
                  onClick={() => setFontSize(size.value)}
                >
                  <span>{size.label}</span>
                  {fontSize === size.value && (
                    <Check size={17} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </fieldset>
          <div className={styles.preview} aria-label="Contoh ukuran tulisan">
            <strong>Telur bagus</strong>
            <span>Contoh tulisan dan angka: 28.000 / kg</span>
          </div>
          <fieldset className={styles.options}>
            <legend>Warna tampilan</legend>
            <div className={styles.themeOptions}>
              <button
                type="button"
                className={theme === "light" ? styles.selected : ""}
                aria-pressed={theme === "light"}
                onClick={() => setTheme("light")}
              >
                <Sun size={20} />
                <span>Terang</span>
                {theme === "light" && <Check size={17} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={theme === "dark" ? styles.selected : ""}
                aria-pressed={theme === "dark"}
                onClick={() => setTheme("dark")}
              >
                <Moon size={20} />
                <span>Gelap</span>
                {theme === "dark" && <Check size={17} aria-hidden="true" />}
              </button>
            </div>
          </fieldset>
        </section>
        <div className={styles.footer}>
          <button
            className="btn btn-light"
            type="button"
            onClick={() => void signOut()}
            disabled={saving}
          >
            <LogOut size={19} /> Keluar akun
          </button>
          <button
            className="btn btn-light"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            Selesai
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function HarvestSettings({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const { state, command } = useFarm();
  const current = state.settings?.harvest_auto_stock !== false;
  const [draft, setDraft] = useState<boolean | null>(null);
  const selected = draft ?? current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true); onBusyChange(true); setError(""); setSaved(false);
    try {
      await command("settings.update", { harvest_auto_stock: selected });
      setDraft(null); setSaved(true);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <form className={styles.preferences} onSubmit={save} aria-label="Pengaturan panen dan gudang">
    <h3><Warehouse size={20} /> Panen & gudang</h3>
    <p>Panen mencatat hasil telur dari kandang. Gudang menghitung telur yang sudah diterima dan siap diambil untuk dijual.</p>
    <label className="d-flex align-items-start gap-3 mb-3">
      <input className="form-check-input flex-shrink-0" type="checkbox" checked={selected} disabled={busy || disabled} onChange={event => { setDraft(event.target.checked); setSaved(false); }} />
      <span><strong>Panen langsung masuk gudang</strong><small className="d-block text-muted">{selected ? "Setelah panen disimpan, stok gudang otomatis bertambah." : "Panen menunggu diterima lewat menu Gudang. Stok bertambah setelah tombol Masukkan ke gudang ditekan."}</small></span>
    </label>
    <p className="small text-muted">Berlaku untuk panen baru. Catatan dan stok yang sudah ada tetap mengikuti statusnya.</p>
    {error && <p className="text-danger" role="alert">{error}</p>}
    {saved && <p className="text-success" role="status">Pengaturan panen berhasil disimpan.</p>}
    <button className="btn btn-primary" type="submit" disabled={busy || disabled || selected === current}><Save size={18} /> {busy ? "Menyimpan…" : "Simpan pengaturan panen"}</button>
  </form>;
}
