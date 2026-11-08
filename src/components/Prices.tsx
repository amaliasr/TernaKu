"use client";

import { Egg, History, Plus } from "lucide-react";
import { activePrice, dateLabel, normalizeDateTime, money } from "@/lib/domain";
import { ALL_EGG_TYPES, NEW_EGG_TYPES, EGG_TYPES, eggTypePrice } from "@/lib/egg-types";
import { useFarm } from "@/lib/store";
import type { Category } from "@/lib/types";
import { Empty, Pill } from "./ModuleUI";
import styles from "./Prices.module.css";

export default function Prices({ open }: { open: (kind: string) => void }) {
  const { state, user } = useFarm();
  const price = activePrice(state);
  const now = Date.now();
  const sources = ALL_EGG_TYPES.map(type => ({ type, price: activePrice({ ...state, prices: state.prices.filter(row => eggTypePrice(row, type) !== undefined) }) }));
  const rows = [...state.prices].sort((a, b) => new Date(normalizeDateTime(b.effective_at)).getTime() - new Date(normalizeDateTime(a.effective_at)).getTime() || b.created_at.localeCompare(a.created_at));
  const hasLegacy = state.prices.some(row => row.good_price !== undefined);
  const rate = (value: number | undefined, type: Category) => value === undefined ? "Belum diatur" : type === "cracked" && value === 0 ? "Gratis" : money(value);
  const priceRow = (type: Category) => {
    const value = eggTypePrice(price, type);
    const source = sources.find(source => source.type === type)?.price;
    return <div key={type} className={styles.priceRow}>
      <span><i className="dot" style={{ backgroundColor: EGG_TYPES[type].color }} />{EGG_TYPES[type].shortLabel}</span>
      <strong>{rate(value, type)}{value !== undefined && value > 0 && <small>/ kg</small>}</strong>
      <small className={styles.since}>{source ? `Berlaku sejak ${dateLabel(source.effective_at, true)} WIB` : "Atasan perlu menetapkan harga sebelum telur ini dijual."}</small>
    </div>;
  };
  return <>
    <div className="page-heading">
      <div><span className="section-label">HARGA JUAL HARIAN</span><h1>Harga telur</h1><p>Harga SKM, SKM Baru, dan Bentes ditetapkan masing-masing.</p></div>
      {user?.role === "admin" && <div className="page-actions"><button type="button" className={`btn btn-primary ${styles.update}`} onClick={() => open("price")}><Plus size={17} />Perbarui harga</button></div>}
    </div>
    <div className={styles.cards}>
      <section className={`panel ${styles.group}`} aria-label="Harga telur bagus">
        <h2><Egg size={21} />Telur bagus</h2>
        {priceRow("skm")}{priceRow("skm_new")}
      </section>
      <section className={`panel ${styles.group}`} aria-label="Harga telur bentes">
        <h2><Egg size={21} />Telur bentes</h2>
        {priceRow("cracked")}
        <p className={styles.note}>{user?.role === "employee" ? "Harga yang tampil diperiksa setiap 5 detik saat aplikasi dibuka." : "Harga di aplikasi karyawan diperiksa setiap 5 detik saat aplikasi dibuka."}</p>
      </section>
    </div>
    {NEW_EGG_TYPES.some(type => eggTypePrice(price, type) === undefined) && <p className="alert alert-info">Harga yang belum diatur tidak dianggap Rp0. Tetapkan harga setiap jenis sebelum mulai menjual.</p>}
    {hasLegacy && <section className={`panel ${styles.legacy}`}>
      <h2>Telur bagus lama yang belum dibedakan</h2>
      <p>Harga terakhir: <strong>{rate(eggTypePrice(price, "good"), "good")}</strong> per kg. Harga ini hanya untuk catatan dan stok lama, terpisah dari SKM dan SKM Baru.</p>
    </section>}
    <section className="panel">
      <div className="panel-header"><div><h2>Riwayat perubahan harga</h2><p>Harga terjadwal aktif sesuai waktu WIB. Tanda — berarti jenis itu tidak diubah pada pembaruan tersebut.</p></div><span className="icon-box"><History size={19} /></span></div>
      {rows.length ? <div className="table-responsive"><table className="table farm-table">
        <thead><tr><th>Mulai berlaku (WIB)</th>{NEW_EGG_TYPES.map(type => <th key={type} className="text-end">{EGG_TYPES[type].shortLabel} / kg</th>)}{hasLegacy && <th className="text-end">Bagus lama / kg</th>}<th>Ditetapkan oleh</th><th>Status</th></tr></thead>
        <tbody>{rows.map(row => {
          const scheduled = new Date(normalizeDateTime(row.effective_at)).getTime() > now;
          const activeTypes = sources.filter(source => source.price?.id === row.id).map(source => EGG_TYPES[source.type].shortLabel);
          return <tr key={row.id}><td>{dateLabel(row.effective_at, true)}</td>
            {[...NEW_EGG_TYPES, ...(hasLegacy ? ["good" as const] : [])].map(type => <td key={type} className="text-end fw-semibold">{eggTypePrice(row, type) === undefined ? "—" : rate(eggTypePrice(row, type), type)}</td>)}
            <td>{state.users.find(user => user.id === row.created_by)?.name || "Admin"}</td>
            <td><Pill tone={scheduled ? "blue" : activeTypes.length ? "success" : "neutral"}>{scheduled ? "Terjadwal" : activeTypes.length ? `Berlaku: ${activeTypes.join(", ")}` : "Riwayat"}</Pill></td>
          </tr>;
        })}</tbody>
      </table></div> : <Empty title="Belum ada riwayat harga" />}
      <div className="table-end"><span>{rows.length} pembaruan harga</span><small>Nota lama tetap memakai harga saat transaksi dibuat.</small></div>
    </section>
  </>;
}
