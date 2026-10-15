"use client";

import { useState } from "react";
import { Download, Share, Smartphone } from "lucide-react";
import { Dialog } from "./ModuleUI";
import { usePwa } from "./PwaProvider";
import styles from "./InstallApp.module.css";

export default function InstallApp() {
  const { installed, canPrompt, ios, install } = usePwa();
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (installed) return null;
  async function startInstall() {
    if (!canPrompt) { setHelp(true); return; }
    setBusy(true);
    const result = await install();
    setBusy(false);
    if (result === "accepted") setMessage("Pemasangan sedang diproses oleh browser. Setelah selesai, buka ikon TernaKu di layar utama.");
    if (result === "dismissed") setMessage("Pemasangan dibatalkan. Anda tetap bisa memakai TernaKu di sini.");
    if (result === "manual" || result === "failed") setHelp(true);
  }
  return <div className={styles.wrap}>
    <button type="button" className={styles.install} onClick={() => void startInstall()} disabled={busy}>
      <Smartphone size={21} aria-hidden="true" />
      <span>{busy ? "Membuka pemasangan…" : "Pasang TernaKu di HP"}</span>
      <Download size={18} aria-hidden="true" />
    </button>
    {message && <p className={styles.message} role="status">{message}</p>}
    {help && <Dialog title="Pasang TernaKu di HP" subtitle="Buka dari ikon di layar utama, seperti aplikasi." onClose={() => setHelp(false)}>
      <div className={styles.help}>
        {ios ? <>
          <h3>Di iPhone atau iPad</h3>
          <ol><li>Buka <strong>ternaku.rstudiohub.com</strong> di Safari.</li><li>Tekan tombol <strong>Bagikan</strong> <Share size={18} aria-hidden="true" />.</li><li>Pilih <strong>Tambahkan ke Layar Utama</strong>, lalu <strong>Tambah</strong>.</li></ol>
        </> : <>
          <h3>Di HP Android</h3>
          <ol><li>Buka <strong>ternaku.rstudiohub.com</strong> di Chrome.</li><li>Tekan menu <strong>⋮</strong> di pojok atas.</li><li>Pilih <strong>Instal aplikasi</strong> atau <strong>Tambahkan ke layar utama</strong>, lalu ikuti petunjuknya.</li></ol>
          <details><summary>Menggunakan iPhone?</summary><p>Buka di Safari → Bagikan → Tambahkan ke Layar Utama → Tambah.</p></details>
        </>}
        <p className={styles.note}>Jika dibuka dari WhatsApp, buka dulu tautannya di browser. TernaKu tetap memerlukan internet untuk harga terbaru dan menyimpan catatan.</p>
        <button type="button" className="btn btn-primary w-100" onClick={() => setHelp(false)}>Mengerti</button>
      </div>
    </Dialog>}
  </div>;
}
