"use client";

import { Egg, History, Plus } from "lucide-react";
import { activePrice, dateLabel, normalizeDateTime, money } from "@/lib/domain";
import { eggTypePrice } from "@/lib/egg-types";
import { useFarm } from "@/lib/store";
import { Empty, Pill } from "./ModuleUI";
import styles from "./Prices.module.css";

export default function Prices({ open }: { open: (kind: string) => void }) {
  const { state, user } = useFarm();
  const price = activePrice(state);
  const now = Date.now();
  const rows = [...state.prices].sort((a, b) => new Date(normalizeDateTime(b.effective_at)).getTime() - new Date(normalizeDateTime(a.effective_at)).getTime() || b.created_at.localeCompare(a.created_at));
  const hasSplitHistory = rows.some(row => row.pricing_mode !== "shared_good" && (row.skm_price !== undefined || row.skm_new_price !== undefined));
  const rate = (value: number | undefined, bentes = false) => value === undefined ? "Belum diatur" : bentes && value === 0 ? "Gratis" : money(value);
  const goodPrice = eggTypePrice(price, "skm"), bentesPrice = eggTypePrice(price, "cracked");
  const currentCards = [
    { label: "Telur Bagus", description: "Satu harga untuk SKM dan SKM Baru.", value: goodPrice, bentes: false },
    { label: "Telur Bentes", description: "Harga Bentes terpisah dari telur bagus.", value: bentesPrice, bentes: true },
  ];
  return <>
    <div className="page-heading">
      <div><span className="section-label">HARGA JUAL HARIAN</span><h1>Harga telur</h1><p>Cukup atur harga Telur Bagus dan Telur Bentes. SKM dan SKM Baru memakai harga yang sama.</p></div>
      {user?.role === "admin" && <div className="page-actions"><button type="button" className={`btn btn-primary ${styles.update}`} onClick={() => open("price")}><Plus size={17} />Perbarui harga</button></div>}
    </div>
    <div className={styles.cards}>
      {currentCards.map(card => <section key={card.label} className={`panel ${styles.group}`} aria-label={`Harga ${card.label.toLowerCase()}`}>
        <h2><Egg size={21} />{card.label}</h2>
        <p className={styles.note}>{card.description}</p>
        <div className={styles.priceRow}>
          <strong className={styles.currentPrice}>{rate(card.value, card.bentes)}{card.value !== undefined && card.value > 0 && <small>/ kg</small>}</strong>
          <small className={styles.since}>{card.value === undefined ? "Atasan perlu menetapkan harga sebelum telur ini dijual." : price ? `Berlaku sejak ${dateLabel(price.effective_at, true)} WIB` : ""}</small>
        </div>
      </section>)}
    </div>
    <p className={styles.pollingNote}>{user?.role === "employee" ? "Harga yang tampil diperiksa setiap 5 detik saat aplikasi dibuka." : "Harga di aplikasi karyawan diperiksa setiap 5 detik saat aplikasi dibuka."}</p>
    {(goodPrice === undefined || bentesPrice === undefined) && <p className="alert alert-info">Harga yang belum diatur tidak dianggap Rp0. Tetapkan harga Telur Bagus dan Telur Bentes sebelum mulai menjual.</p>}
    <section className="panel">
      <div className="panel-header"><div><h2>Riwayat perubahan harga</h2><p>Harga terjadwal aktif sesuai waktu WIB. Harga pada nota lama tetap tersimpan.</p>{hasSplitHistory && <p>Kolom harga SKM lama hanya untuk riwayat. Setelah harga bersama berlaku, jadwal harga dengan aturan lama tidak dipakai lagi.</p>}</div><span className="icon-box"><History size={19} /></span></div>
      {rows.length ? <div className="table-responsive"><table className="table farm-table">
        <thead><tr><th>Mulai berlaku (WIB)</th><th className="text-end">Telur Bagus / kg</th><th className="text-end">Telur Bentes / kg</th>{hasSplitHistory && <><th className="text-end">SKM (harga lama)</th><th className="text-end">SKM Baru (harga lama)</th></>}<th>Ditetapkan oleh</th><th>Status</th></tr></thead>
        <tbody>{rows.map(row => {
          const scheduled = new Date(normalizeDateTime(row.effective_at)).getTime() > now;
          const archivedPolicy = price?.pricing_mode === "shared_good" && row.pricing_mode !== "shared_good";
          const active = price?.id === row.id;
          return <tr key={row.id}><td>{dateLabel(row.effective_at, true)}</td>
            <td className="text-end fw-semibold">{row.good_price === undefined ? "—" : rate(row.good_price)}</td>
            <td className="text-end fw-semibold">{rate(row.cracked_price, true)}</td>
            {hasSplitHistory && <><td className="text-end">{row.pricing_mode !== "shared_good" && row.skm_price !== undefined ? money(row.skm_price) : "—"}</td><td className="text-end">{row.pricing_mode !== "shared_good" && row.skm_new_price !== undefined ? money(row.skm_new_price) : "—"}</td></>}
            <td>{state.users.find(user => user.id === row.created_by)?.name || "Admin"}</td>
            <td><Pill tone={archivedPolicy ? "neutral" : scheduled ? "blue" : active ? "success" : "neutral"}>{archivedPolicy ? "Arsip aturan lama" : scheduled ? "Terjadwal" : active ? "Sedang berlaku" : "Riwayat"}</Pill></td>
          </tr>;
        })}</tbody>
      </table></div> : <Empty title="Belum ada riwayat harga" />}
      <div className="table-end"><span>{rows.length} pembaruan harga</span><small>Panen dan stok tetap dipisahkan menjadi SKM, SKM Baru, dan Bentes.</small></div>
    </section>
  </>;
}
