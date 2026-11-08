"use client";

import { useRef, useState, type FormEvent } from "react";
import { eggStock, number } from "@/lib/domain";
import { useFarm } from "@/lib/store";
import type { Quantity, State } from "@/lib/types";
import { categoryLabel, Dialog, errorMessage, Field, LoadingButton } from "./ModuleUI";

type Target = "skm" | "skm_new";
const units = ["eggs", "kg", "trays"] as const;
const snapshot = (state: State) => ({ good: eggStock(state, "good"), skm: eggStock(state, "skm"), skm_new: eggStock(state, "skm_new") });
const describe = (q: Quantity) => `${number(q.eggs)} butir · ${number(q.kg, 3)} kg · ${number(q.trays)} krat`;

/** Splits existing legacy stock without changing the total inventory. */
export default function StockClassification() {
  const { state, user, refresh } = useFarm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const stock = eggStock(state, "good");
  if (user?.role !== "admin" || (!stock.eggs && !stock.kg && !stock.trays && !notice)) return null;
  async function begin() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await refresh(); setOpen(true); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className="panel p-3 mb-3" aria-label="Pisahkan stok telur bagus lama">
    <h2 className="h5">Pisahkan stok telur bagus lama</h2>
    <p className="small text-muted">Stok ini belum dibedakan: <strong>{describe(stock)}</strong>. Tentukan bagian yang termasuk SKM atau SKM Baru. Jumlah stok keseluruhan tetap sama.</p>
    <button type="button" className="btn btn-outline-primary" disabled={busy || stock.kg <= 0 || stock.eggs <= 0} onClick={() => void begin()}>{busy ? "Memuat stok…" : "Bagikan ke jenis telur"}</button>
    {error && <p className="alert alert-danger mt-3 mb-0" role="alert">{error}</p>}
    {notice && <p className="alert alert-success mt-3 mb-0" role="status">{notice}</p>}
    {open && <ClassifyDialog close={() => setOpen(false)} saved={() => { setOpen(false); setNotice("Stok lama sudah dibagikan. Riwayatnya tercatat di pergerakan stok."); }} />}
  </section>;
}

function ClassifyDialog({ close, saved }: { close: () => void; saved: () => void }) {
  const { state, command, refresh } = useFarm();
  const [expected, setExpected] = useState(() => snapshot(state));
  const [category, setCategory] = useState<Target>("skm");
  const [amount, setAmount] = useState({ eggs: "", kg: "", trays: "" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const guard = useRef(false);
  const live = snapshot(state);
  const stale = (["good", category] as const).some(type => units.some(unit => live[type][unit] !== expected[type][unit]));
  const quantity = { eggs: Number(amount.eggs), kg: Number(amount.kg), trays: Number(amount.trays) };
  const tooMuch = units.some(unit => quantity[unit] > expected.good[unit]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current || stale || conflict) return;
    if (!quantity.eggs || !quantity.kg || tooMuch) { setError("Isi butir dan berat sesuai bagian stok lama yang akan dipindahkan."); return; }
    if (reason.trim().length < 5) { setError("Tulis alasan pembagian, minimal 5 karakter."); return; }
    guard.current = true; setBusy(true); setError("");
    try {
      await command("stock.classify", { category, ...quantity, expected_source: expected.good, expected_target: expected[category], reason: reason.trim() });
      saved();
    } catch (cause) { setError(errorMessage(cause)); setConflict(true); }
    finally { guard.current = false; setBusy(false); }
  }
  async function reload() {
    if (guard.current) return;
    guard.current = true; setBusy(true);
    try { await refresh(); setConflict(false); setError(""); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { guard.current = false; setBusy(false); }
  }
  const safeClose = () => { if (guard.current) return false; close(); };
  return <Dialog title="Bagikan stok lama" subtitle="Jumlah keseluruhan tidak bertambah atau berkurang." onClose={safeClose}>
    <form onSubmit={submit} style={{ minWidth: 0 }}><fieldset className="modal-body-custom" disabled={busy} style={{ minWidth: 0 }}>
      <p className="alert alert-light border"><strong>Telur bagus yang belum dibedakan</strong><br />{describe(expected.good)}</p>
      <Field className="d-block mb-3" label="Masukkan sebagai">
        <select className="form-select" value={category} onChange={event => setCategory(event.target.value as Target)}><option value="skm">Telur SKM</option><option value="skm_new">Telur SKM Baru</option></select>
      </Field>
      <p className="small text-muted">Stok {categoryLabel(category)} sekarang: {describe(expected[category])}.</p>
      <div className="row g-3 mb-3">{units.map(unit => <Field key={unit} className="col-12 col-sm-4" label={unit === "eggs" ? "Jumlah butir" : unit === "kg" ? "Berat (kg)" : "Krat (boleh kosong)"}>
        <input className="form-control" type="number" inputMode={unit === "kg" ? "decimal" : "numeric"} min={unit === "kg" ? ".001" : unit === "eggs" ? "1" : "0"} max={expected.good[unit]} step={unit === "kg" ? ".001" : "1"} required={unit !== "trays"} value={amount[unit]} onChange={event => setAmount({ ...amount, [unit]: event.target.value })} />
      </Field>)}</div>
      <Field className="d-block" label="Alasan pembagian (wajib)"><textarea className="form-control" rows={2} minLength={5} maxLength={1000} required value={reason} onChange={event => setReason(event.target.value)} placeholder="Contoh: sudah dipilah berdasarkan sumber kandang." /></Field>
      {(stale || conflict) && <div className="alert alert-warning mt-3" role="alert"><p>Periksa stok terbaru sebelum membagikan. Isian Anda tetap tersimpan.</p><div className="d-flex gap-2 flex-wrap"><button type="button" className="btn btn-light" onClick={() => void reload()}>Muat ulang stok</button><button type="button" className="btn btn-outline-secondary" onClick={() => { setExpected(snapshot(state)); setConflict(false); setError(""); }}>Gunakan angka terbaru</button></div></div>}
      {tooMuch && <p className="text-danger mt-2">Jumlah melebihi stok lama yang tersedia.</p>}
      {error && <p className="alert alert-danger mt-3 mb-0" role="alert">{error}</p>}
    </fieldset><div className="modal-footer-custom"><button className="btn btn-light" type="button" disabled={busy} onClick={safeClose}>Batal</button><LoadingButton busy={busy} disabled={stale || conflict || tooMuch}>Simpan pembagian</LoadingButton></div></form>
  </Dialog>;
}
