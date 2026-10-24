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
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (!user) return null;
  const changed = name.trim() !== user.name || photo !== (user.photo || "");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || photoBusy) return;
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      await command("profile.update", {
        name: name.trim(),
        ...(photo !== (user?.photo || "") ? { photo } : {}),
      });
      setName(name.trim());
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (busy) return;
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
        if (busy) return false;
        onClose();
      }}
    >
      <div className={styles.content}>
        <div className={styles.identity}>
          <Avatar user={{ name: name || user.name, photo }} size="lg" />
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <small>
              {user.role === "admin" ? "Atasan / admin" : "Karyawan"}
            </small>
          </div>
        </div>
        <form onSubmit={save}>
          <fieldset disabled={busy} className={styles.profileFields}>
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
              onChange={(value) => {
                setPhoto(value);
                setSaved(false);
              }}
              onBusyChange={setPhotoBusy}
              label="Foto profil"
              capture="user"
              disabled={busy}
            />
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy || photoBusy || !changed}
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
            disabled={busy}
          >
            <LogOut size={19} /> Keluar akun
          </button>
          <button
            className="btn btn-light"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Selesai
          </button>
        </div>
      </div>
    </Dialog>
  );
}
