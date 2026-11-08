"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ClipboardCheck, RefreshCw, TriangleAlert } from "lucide-react";
import { businessDate, dateLabel, number, today } from "@/lib/domain";
import { ALL_EGG_TYPES } from "@/lib/egg-types";
import { reportRange } from "@/lib/report-range";
import { ApiError } from "@/lib/request-errors";
import { harvestCounts, sameCheckCounts } from "@/lib/stock-checks";
import { useFarm } from "@/lib/store";
import type { Category, Quantity, State, StockCheck, StockCheckContext } from "@/lib/types";
import { categoryLabel, Dialog, errorMessage, Field, LoadingButton, Pill } from "./ModuleUI";
import { CorrectionDialog, type SelectedRecord } from "./RecordDialogs";
import styles from "./StockChecks.module.css";

type Totals = Record<Category, Quantity>;
type Inputs = Record<Category, Record<keyof Quantity, string>>;
type CheckMode = "confirmed" | "pending";
const categories = ALL_EGG_TYPES;
const units = [{ key: "kg", label: "Berat (kg)" }, { key: "eggs", label: "Butir" }, { key: "trays", label: "Krat" }] as const;
const quantityText = (value: Quantity) => `${number(value.kg, 3)} kg · ${number(value.eggs)} butir · ${number(value.trays)} krat`;
const hasQuantity = (value: Quantity | undefined) => !!value && (value.eggs !== 0 || value.kg !== 0 || value.trays !== 0);
const inputTotals = (totals: Totals): Inputs => Object.fromEntries(categories.map(category => [category, {
  kg: String(totals[category].kg), eggs: String(totals[category].eggs), trays: String(totals[category].trays),
}])) as Inputs;
const readTotals = (inputs: Inputs): Totals => Object.fromEntries(categories.map(category => [category, {
  kg: Number(inputs[category].kg), eggs: Number(inputs[category].eggs), trays: Number(inputs[category].trays),
}])) as Totals;
const statusLabel = { confirmed: "Sudah cocok", pending: "Ada selisih", approved: "Sudah diselesaikan", rejected: "Perlu diperiksa ulang", superseded: "Diganti pemeriksaan baru" };
const statusTone = { confirmed: "success", pending: "warning", approved: "success", rejected: "danger", superseded: "neutral" };

function latestChecks(state: State, day: string) {
  const checks = new Map<string, StockCheck>();
  for (const row of [...(state.stock_checks || [])].sort((a, b) => (a.updated_at || a.created_at).localeCompare(b.updated_at || b.created_at))) {
    if (row.date === day && row.status !== "superseded") checks.set(row.user_id, row);
  }
  return checks;
}
function TotalsCards({ totals }: { totals: Partial<Totals> }) {
  return <div className={styles.totals}>{categories.filter(category => totals[category] !== undefined && (category !== "good" || hasQuantity(totals.good))).map(category => {
    const quantity = totals[category]!;
    return <div className={styles.total} key={category}><span>{categoryLabel(category)}</span><strong>{number(quantity.kg, 3)}<small>kg</small></strong>
      <small>{number(quantity.eggs)} butir · {number(quantity.trays)} krat</small></div>;
  })}</div>;
}
function Comparison({ title, expected, actual }: { title: string; expected: Partial<Totals>; actual: Partial<Totals> }) {
  return <section><h3>{title}</h3><div className={styles.totals}>{categories.filter(category => (expected[category] !== undefined || actual[category] !== undefined) && (category !== "good" || hasQuantity(expected.good) || hasQuantity(actual.good))).map(category => <div className={styles.total} key={category}>
    <b>{categoryLabel(category)}</b><span>Tercatat saat diperiksa</span><p className="small mb-1">{expected[category] ? quantityText(expected[category]!) : "Belum dicatat"}</p>
    <span>Hasil hitung petugas</span><p className="small mb-0 fw-semibold">{actual[category] ? quantityText(actual[category]!) : "Belum dicatat"}</p>
  </div>)}</div></section>;
}

/** Mounted in both warehouse workspaces; the server remains the authority for assignment. */
export default function StockChecks() {
  const { user } = useFarm();
  if (user?.role === "admin") return <AdminChecks />;
  return user?.can_check_stock && user.active && !user.deleted_at ? <EmployeeChecks /> : null;
}

function EmployeeChecks() {
  const { state, user, refresh } = useFarm();
  const [mode, setMode] = useState<CheckMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const guard = useRef(false);
  const context = state.stock_check_context;
  const check = latestChecks(state, today()).get(user!.id);
  const finished = check?.schema_version === 2 && (check.status === "confirmed" || check.status === "approved");
  async function begin(next: CheckMode) {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError(""); setNotice("");
    try { await refresh(); setMode(next); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { guard.current = false; setBusy(false); }
  }
  return <section className={styles.panel} aria-label="Cocokkan gudang">
    <div className={styles.header}><div><h2><ClipboardCheck size={23} /> Cocokkan gudang</h2>
      <p className={styles.caption}>Hitung telur di gudang dan periksa catatan panen hari ini.</p></div>
      {check ? <Pill tone={statusTone[check.status]}>{statusLabel[check.status]}</Pill> : <Pill tone="warning">Belum diperiksa hari ini</Pill>}
    </div>
    {check && <p className={styles.caption}>Terakhir diperiksa {dateLabel(check.updated_at || check.created_at, true)} WIB.</p>}
    {check && check.schema_version !== 2 && <p className={styles.note}>Pemeriksaan sebelumnya memakai format lama. Catatan telur bagus lama sekarang termasuk SKM. Periksa kembali jumlah hari ini.</p>}
    {check?.review_reason && <p className={styles.note}>Catatan atasan: {check.review_reason}</p>}
    {error && <p className="alert alert-danger" role="alert">{error}</p>}
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    {!finished && <div className={styles.actions}>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void begin("confirmed")}><CheckCircle2 size={19} /> {busy ? "Memuat angka terbaru…" : "Jumlah sudah cocok"}</button>
      <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => void begin("pending")}><TriangleAlert size={19} /> Ada selisih</button>
    </div>}
    {mode && context?.date === today() && context.schema_version === 2 && <CountCheckDialog context={context} mode={mode} close={() => setMode(null)} saved={() => {
      setMode(null); setNotice(mode === "confirmed" ? "Pemeriksaan hari ini sudah tersimpan." : "Selisih sudah dilaporkan. Atasan akan memeriksa catatannya.");
    }} />}
    {mode && (context?.date !== today() || context.schema_version !== 2) && <p className="alert alert-warning mt-3 mb-0" role="alert">Angka pemeriksaan belum tersedia. Muat ulang halaman dan coba lagi.</p>}
  </section>;
}

function CountCheckDialog({ context, mode, close, saved }: { context: StockCheckContext; mode: CheckMode; close: () => void; saved: () => void }) {
  const { state, command, refresh } = useFarm();
  const [expected, setExpected] = useState(context);
  const [warehouse, setWarehouse] = useState(() => inputTotals(context.warehouse));
  const [harvest, setHarvest] = useState(() => inputTotals(context.harvest));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [acceptLatest, setAcceptLatest] = useState(false);
  const guard = useRef(false);
  const current = state.stock_check_context;
  const stale = current?.schema_version !== 2 || current?.snapshot !== expected.snapshot || expected.date !== today();
  useEffect(() => {
    if (!acceptLatest || !current) return;
    setExpected(current); setAcceptLatest(false); setConflict(false); setError("");
  }, [acceptLatest, current]);
  async function reload() {
    if (guard.current) return;
    guard.current = true; setBusy(true);
    try { await refresh(); setAcceptLatest(true); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { guard.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current || stale || conflict) return;
    if (mode === "pending" && reason.trim().length < 5) { setError("Ceritakan selisih yang Anda temukan, minimal 5 karakter."); return; }
    if (mode === "pending") {
      const actuals = [{ label: "Gudang", values: readTotals(warehouse) }, { label: "Panen", values: readTotals(harvest) }];
      for (const { label, values } of actuals) for (const category of categories) {
        const value = values[category];
        if ((value.eggs === 0) !== (value.kg === 0)) {
          setError(`${label}, ${categoryLabel(category).toLowerCase()}: isi butir dan berat. Jika tidak ada telur, isi keduanya dengan 0.`); return;
        }
      }
      if (sameCheckCounts(actuals[0].values, expected.warehouse) && sameCheckCounts(actuals[1].values, expected.harvest)) {
        setError("Jumlah masih sama dengan catatan. Ubah angka yang berbeda, atau kembali dan pilih Jumlah sudah cocok."); return;
      }
    }
    guard.current = true; setBusy(true); setError("");
    try {
      await command("stock_check.submit", { schema_version: 2, date: expected.date, expected_snapshot: expected.snapshot, status: mode,
        ...(mode === "pending" ? { warehouse_actual: readTotals(warehouse), harvest_actual: readTotals(harvest), reason: reason.trim() } : {}),
      }); saved();
    } catch (cause) { setError(errorMessage(cause)); setConflict(cause instanceof ApiError && cause.status === 409); }
    finally { guard.current = false; setBusy(false); }
  }
  const safeClose = () => { if (guard.current) return false; close(); };
  return <Dialog title={mode === "confirmed" ? "Pastikan jumlah sudah cocok" : "Catat hasil hitung sebenarnya"} subtitle={`${dateLabel(expected.date)} · Periksa setiap jenis telur`} onClose={safeClose}>
    <form onSubmit={submit}>
      <div className={styles.body}>
        <section><h3>Stok gudang yang tercatat</h3><TotalsCards totals={expected.warehouse} /></section>
        <section><h3>Panen hari ini yang tercatat</h3><TotalsCards totals={expected.harvest} /><p className={`${styles.caption} mt-2`}>Termasuk panen yang belum diterima di gudang.</p></section>
        {mode === "confirmed" ? <p className={styles.note}>Simpan setelah jumlah di gudang dan catatan panen di atas sesuai dengan hasil pemeriksaan Anda.</p> : <>
          <p className={styles.caption}>Isi jumlah sebenarnya. Angka yang sudah benar tidak perlu diubah.</p>
          <fieldset disabled={busy}>
            <ActualInputs title="Hasil hitung gudang" value={warehouse} onChange={setWarehouse} />
            <ActualInputs title="Hasil pemeriksaan panen hari ini" value={harvest} onChange={setHarvest} />
            <Field className="d-block" label="Selisih yang ditemukan (wajib)"><textarea className="form-control" rows={3} value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={1000} required placeholder="Contoh: panen SKM tercatat 20 kg, seharusnya 22 kg." /></Field>
          </fieldset>
        </>}
        {(stale || conflict) && <div className="alert alert-warning mb-0" role="alert"><p>Periksa angka terbaru sebelum menyimpan lagi. Isian Anda masih tersimpan di formulir ini.</p><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => void reload()}><RefreshCw size={17} /> Muat ulang dan hitung lagi</button></div>}
        {error && <p className="alert alert-danger mb-0" role="alert">{error}</p>}
      </div>
      <div className={styles.footer}><button type="button" className="btn btn-light" disabled={busy} onClick={safeClose}>Batal</button><LoadingButton busy={busy} disabled={stale || conflict}>{mode === "confirmed" ? "Simpan pemeriksaan" : "Kirim selisih ke atasan"}</LoadingButton></div>
    </form>
  </Dialog>;
}
function ActualInputs({ title, value, onChange }: { title: string; value: Inputs; onChange: (value: Inputs) => void }) {
  return <fieldset className="mb-4"><legend>{title}</legend><div className={styles.entries}>{categories.filter(category => category !== "good" || Object.values(value.good).some(n => Number(n) !== 0)).map(category => <div className={styles.entry} key={category}>
    <h3>{categoryLabel(category)}</h3><div className={styles.quantities}>{units.map(({ key, label }) => <Field key={key} label={label}>
      <input className="form-control" aria-label={`${title} ${categoryLabel(category)} ${label}`} type="number" inputMode={key === "kg" ? "decimal" : "numeric"} min="0" step={key === "kg" ? "0.001" : "1"} required value={value[category][key]}
        onChange={event => onChange({ ...value, [category]: { ...value[category], [key]: event.target.value } })} />
    </Field>)}</div>
  </div>)}</div></fieldset>;
}

function AdminChecks() {
  const { state, refresh } = useFarm();
  const [day, setDay] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const range = reportRange("30days");
  const valid = day >= range.from && day <= range.to;
  const checks = valid ? latestChecks(state, day) : new Map<string, StockCheck>();
  const assigned = new Map<string, boolean>();
  for (const event of [...(state.stock_check_assignments || [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (businessDate(event.created_at) <= day) assigned.set(event.user_id, event.assigned);
  }
  const memberIds = new Set([...assigned].filter(([, active]) => active).map(([id]) => id));
  if (day === today()) for (const user of state.users) if (user.can_check_stock && user.active && !user.deleted_at) memberIds.add(user.id);
  for (const id of checks.keys()) memberIds.add(id);
  const members = valid ? [...memberIds].map(id => ({ id, name: state.users.find(user => user.id === id)?.name || "Petugas sebelumnya", check: checks.get(id) })) : [];
  const selectedCheck = state.stock_checks?.find(row => row.id === selected);
  async function reload() { if (busy) return; setBusy(true); setError(""); try { await refresh(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <section className={styles.panel} aria-label="Pemeriksaan gudang harian">
    <div className={styles.header}><div><h2><ClipboardCheck size={23} /> Pemeriksaan gudang</h2><p className={styles.caption}>Pantau pemeriksaan setiap petugas selama 30 hari terakhir.</p></div>
      <Field className={styles.dateField} label="Tanggal pemeriksaan"><input className="form-control" type="date" min={range.from} max={range.to} value={day} onChange={event => setDay(event.target.value)} /></Field>
    </div>
    <div className="d-flex gap-2 flex-wrap mb-3"><button type="button" className="btn btn-light" onClick={() => setDay(today())}>Hari ini</button><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => void reload()}><RefreshCw size={17} /> {busy ? "Memuat…" : "Muat ulang"}</button></div>
    {!valid && <p className="alert alert-warning" role="alert">Pilih tanggal dalam 30 hari terakhir.</p>}
    {error && <p className="alert alert-danger" role="alert">{error}</p>}
    {valid && !members.length && <p className={styles.note}>Belum ada petugas pada tanggal ini. Pilih petugas melalui menu Karyawan → Edit akun → Petugas pemeriksa gudang.</p>}
    <div className={styles.entries}>{members.map(({ id, name, check }) => <article className={styles.entry} key={id}>
      <div className={styles.rowHeading}><strong>{name}</strong><Pill tone={check ? statusTone[check.status] : "neutral"}>{check ? statusLabel[check.status] : "Belum diperiksa"}</Pill></div>
      {check ? <><small>{dateLabel(check.updated_at || check.created_at, true)} WIB</small>{check.reason && <p>{check.reason}</p>}<button className="btn btn-outline-primary" type="button" onClick={() => setSelected(check.id)}>{check.status === "pending" ? "Periksa selisih" : "Lihat pemeriksaan"}</button></> : <p className={styles.caption}>Belum ada pemeriksaan yang dikirim untuk tanggal ini.</p>}
    </article>)}</div>
    {selectedCheck && <ReviewCheck check={selectedCheck} close={() => setSelected(null)} />}
  </section>;
}

function ReviewCheck({ check, close }: { check: StockCheck; close: () => void }) {
  const { state, command } = useFarm();
  const [correction, setCorrection] = useState<SelectedRecord | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const pending = check.status === "pending";
  const harvest = harvestCounts(state.productions, check.date);
  const legacy = check.schema_version !== 2;
  const harvestMatches = !legacy && sameCheckCounts(harvest, check.harvest_actual);
  const productions = state.productions.filter(row => check.production_ids.includes(row.id));
  async function review(decision: "approve" | "reject") {
    if (guard.current || (decision === "approve" && !harvestMatches)) return;
    if (decision === "reject" && reason.trim().length < 5) { setError("Isi catatan minimal 5 karakter agar petugas tahu apa yang perlu diperiksa ulang."); return; }
    guard.current = true; setBusy(true); setError("");
    try { await command("stock_check.review", { schema_version: 2, id: check.id, decision, reason: reason.trim() }); close(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { guard.current = false; setBusy(false); }
  }
  const safeClose = () => { if (guard.current) return false; close(); };
  if (correction) return <CorrectionDialog selected={correction} onClose={() => setCorrection(null)} />;
  return <Dialog title={pending ? "Periksa selisih gudang" : "Hasil pemeriksaan gudang"} subtitle={`${state.users.find(user => user.id === check.user_id)?.name || "Petugas"} · ${dateLabel(check.date)}`} onClose={safeClose}>
    <div className={styles.body}>
      <Pill tone={statusTone[check.status]}>{statusLabel[check.status]}</Pill>
      {check.reason && <p className={styles.note}>{check.reason}</p>}
      <Comparison title="Stok gudang" expected={check.expected.warehouse} actual={check.warehouse_actual} />
      <Comparison title="Panen pada tanggal pemeriksaan" expected={check.expected.harvest} actual={check.harvest_actual} />
      {legacy && <p className="alert alert-warning mb-0">Pemeriksaan ini memakai format sebelumnya. Catatan telur bagus lama sekarang ditampilkan sebagai SKM. {pending ? "Minta petugas melakukan pemeriksaan baru; hasil lama ini tidak bisa disetujui." : ""}</p>}
      {pending && <><section><h3>Catatan panen saat ini</h3><TotalsCards totals={harvest} /></section>
        <p className={harvestMatches ? "alert alert-success mb-0" : "alert alert-warning mb-0"}>{harvestMatches ? "Total panen sudah sesuai dengan hasil pemeriksaan petugas. Periksa hasil hitung gudang sebelum menyetujui." : "Total panen masih berbeda. Koreksi catatan panen yang salah satu per satu sebelum menyetujui."}</p>
        <section><h3>Catatan panen yang diperiksa</h3><div className={styles.entries}>{productions.map(row => <article className={styles.entry} key={row.id}>
          <strong>{state.users.find(user => user.id === row.user_id)?.name || "Karyawan"} · {categoryLabel(row.category)}</strong><small>{dateLabel(row.created_at, true)} WIB</small><p>{quantityText(row)}</p>
          <button type="button" className="btn btn-outline-primary" disabled={busy} onClick={() => setCorrection({ entity: "production", record: row })}>Koreksi panen ini</button>
        </article>)}</div>{!productions.length && <p className={styles.caption}>Tidak ada catatan panen pada pemeriksaan ini.</p>}</section>
        <Field label="Catatan untuk petugas" className="d-block"><textarea className="form-control" rows={3} maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Wajib diisi jika meminta pemeriksaan ulang." /></Field>
        <p className={styles.caption}>Jika ada transaksi gudang setelah pemeriksaan ini, petugas perlu menghitung ulang. Sistem memeriksanya saat Anda menyetujui.</p>
      </>}
      {check.review_reason && <p className={styles.note}>Catatan atasan: {check.review_reason}</p>}
      {check.reviewed_at && <p className={styles.caption}>Ditinjau {dateLabel(check.reviewed_at, true)} WIB.</p>}
      {error && <p className="alert alert-danger mb-0" role="alert">{error}</p>}
    </div>
    <div className={styles.footer}>{pending ? <><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => void review("reject")}>Minta periksa ulang</button><button type="button" className="btn btn-primary" disabled={busy || legacy || !harvestMatches} onClick={() => void review("approve")}>{busy ? "Menyimpan…" : "Setujui hasil pemeriksaan"}</button></> : <button type="button" className="btn btn-light" onClick={safeClose}>Tutup</button>}</div>
  </Dialog>;
}
