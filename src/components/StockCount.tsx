"use client";

import { useRef, useState, type FormEvent } from "react";
import { ClipboardList } from "lucide-react";
import { ALL_EGG_TYPES } from "@/lib/egg-types";
import { dateLabel, eggStock, number } from "@/lib/domain";
import { useFarm } from "@/lib/store";
import type { Category, Quantity, State, StockAdjustmentMethod, StockMovement } from "@/lib/types";
import { adjustmentMethodLabel, categoryLabel, Dialog, errorMessage, Field, LoadingButton } from "./ModuleUI";

const categories = ALL_EGG_TYPES;
const units = [
  { key: "eggs", label: "Butir", unit: "butir" },
  { key: "kg", label: "Berat (kg)", unit: "kg" },
  { key: "trays", label: "Krat", unit: "krat" },
] as const;
const signed = (value: number) => (value > 0 ? "+" : "") + number(value, 3);
type CountScope = Category | "all";
const methods: StockAdjustmentMethod[] = ["count", "add", "subtract"];

function snapshot(state: State) {
  return Object.fromEntries(categories.map(type => [type, eggStock(state, type)])) as Record<Category, Quantity>;
}

function initialInputs(stock: ReturnType<typeof snapshot>, method: StockAdjustmentMethod) {
  const fields = (q: Quantity) => method === "count"
    ? { eggs: String(q.eggs), kg: String(q.kg), trays: String(q.trays ?? 0) }
    : { eggs: "", kg: "", trays: "" };
  return Object.fromEntries(categories.map(type => [type, fields(stock[type])])) as Record<Category, Record<keyof Quantity, string>>;
}

function applyAmount(before: Quantity, input: Record<keyof Quantity, string>, method: StockAdjustmentMethod): Quantity {
  const amount = (key: keyof Quantity) => {
    const entered = Number(input[key]);
    if (method === "count") return entered;
    return Number(((before[key] ?? 0) + (method === "add" ? entered : -entered)).toFixed(3));
  };
  return { eggs: amount("eggs"), kg: amount("kg"), trays: amount("trays") };
}

function quantityText(value: Partial<Quantity>, showSign = false) {
  const format = showSign ? signed : (n: number) => number(n, 3);
  return units.map(({ key, unit }) => {
    const n = value[key];
    return n == null ? `${unit} belum dicatat` : `${format(n)} ${unit}`;
  }).join(" · ");
}

function AdjustmentHistory({ rows }: { rows: StockMovement[] }) {
  const { state } = useFarm();
  const [limit, setLimit] = useState(5);
  return (
    <details className="mt-3">
      <summary className="fw-semibold">Riwayat penyesuaian</summary>
      {!rows.length && <p className="text-muted mt-2 mb-0">Belum ada penyesuaian stok.</p>}
      {rows.slice(0, limit).map((row) => (
        <article key={row.id} className="border-top py-3 small">
          <strong>{adjustmentMethodLabel(row.method)} · {categoryLabel(row.category)}</strong>
          <div className="text-muted">
            {dateLabel(row.created_at, true)} WIB · {state.users.find(u => u.id === row.user_id)?.name || "Admin"}
          </div>
          <dl className="row gx-2 gy-1 mb-1 mt-2">
            {row.expected && <><dt className="col-3">Sebelum</dt><dd className="col-9 mb-0">{quantityText(row.expected)}</dd></>}
            {row.physical && <><dt className="col-3">Sesudah</dt><dd className="col-9 mb-0">{quantityText(row.physical)}</dd></>}
            <dt className="col-3">Selisih</dt>
            <dd className="col-9 mb-0">{quantityText({ eggs: row.eggs, kg: row.kg, trays: row.physical?.trays == null ? undefined : row.trays }, true)}</dd>
            <dt className="col-3">Alasan</dt><dd className="col-9 mb-0 text-break">{row.notes || "Belum dicatat"}</dd>
          </dl>
        </article>
      ))}
      {rows.length > limit && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setLimit(limit + 5)}>Tampilkan lebih banyak</button>}
    </details>
  );
}

export default function StockCount() {
  const { state, user, refresh } = useFarm();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (user?.role !== "admin") return null;
  const history = (state.stock_movements ?? []).filter(m => m.kind === "reconcile")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  async function start() {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      await refresh();
      setOpen(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="panel p-3 mb-3" aria-label="Penyesuaian stok gudang">
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2">
        <div>
          <h2 className="h5">Penyesuaian stok gudang</h2>
          <p className="small text-muted mb-0">Tambah, kurangi, atau cocokkan stok dengan hasil hitung fisik.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void start()}>
          <ClipboardList size={17} aria-hidden /> {loading ? "Memuat stok…" : "Sesuaikan stok"}
        </button>
      </div>
      {error && <p className="alert alert-danger mt-2 mb-0" role="alert">{error}</p>}
      {notice && <p className="alert alert-success mt-2 mb-0" role="status">{notice}</p>}
      <AdjustmentHistory rows={history} />
      {open && <CountDialog close={() => setOpen(false)} saved={() => {
        setOpen(false);
        setNotice("Penyesuaian stok sudah tersimpan.");
      }} />}
    </section>
  );
}

function CountDialog({ close, saved }: { close: () => void; saved: () => void }) {
  const { state, command, refresh } = useFarm();
  const [expected, setExpected] = useState(() => snapshot(state));
  const [scope, setScope] = useState<CountScope>("skm");
  const [method, setMethod] = useState<StockAdjustmentMethod>("count");
  const [counts, setCounts] = useState(() => initialInputs(expected, method));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const selected = scope === "all" ? categories : [scope];
  const rows = selected.map(category => ({
    category,
    expected: expected[category],
    physical: applyAmount(expected[category], counts[category], method),
  }));
  const saveRows = method === "count" ? rows : rows.filter(row => units.some(({ key }) => row.physical[key] !== row.expected[key]));
  const stale = rows.some(row => {
    const live = eggStock(state, row.category);
    return units.some(({ key }) => live[key] !== row.expected[key]);
  });
  async function loadLatest() {
    try {
      await refresh();
      setNeedsRefresh(false);
      setError("");
    } catch (e) {
      setNeedsRefresh(true);
      setError(errorMessage(e));
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current || stale || conflict) return;
    if (!saveRows.length) { setError("Isi jumlah stok yang ingin diubah."); return; }
    if (!reason.trim()) { setError("Isi alasan penyesuaian stok."); return; }
    if (saveRows.some(row => units.some(({ key }) => row.physical[key] < 0))) {
      setError("Jumlah yang dikurangi melebihi stok gudang.");
      return;
    }
    const incomplete = saveRows.find(({ physical }) => (physical.eggs === 0) !== (physical.kg === 0));
    if (incomplete) {
      setError(`${categoryLabel(incomplete.category)}: isi jumlah butir dan berat. Jika telur habis, isi keduanya dengan 0.`);
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await command("stock.reconcile", { items: saveRows, reason: reason.trim(), method });
      saved();
    } catch (e) {
      const message = errorMessage(e);
      setError(message);
      if (message.includes("Stok berubah")) {
        setConflict(true);
        await loadLatest();
      }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  function safeClose() {
    if (guard.current) return false;
    close();
  }
  return (
    <Dialog title="Sesuaikan stok gudang" onClose={safeClose}>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="modal-body-custom">
          <div className="row g-2 mb-3">
          <Field label="Jenis penyesuaian" className="col-12 col-sm-6">
            <select className="form-select" value={method} onChange={e => {
              const next = e.target.value as StockAdjustmentMethod;
              setMethod(next);
              setCounts(initialInputs(expected, next));
              setError("");
            }}>
              {methods.map(value => <option key={value} value={value}>{adjustmentMethodLabel(value)}</option>)}
            </select>
          </Field>
          <Field label="Kategori telur" className="col-12 col-sm-6">
            <select className="form-select" value={scope} onChange={e => { setScope(e.target.value as CountScope); setError(""); }}>
              {categories.map(type => <option key={type} value={type}>{categoryLabel(type)}</option>)}
              <option value="all">Semua jenis telur</option>
            </select>
          </Field>
          </div>
          {rows.map(({ category, expected: before, physical }) => (
            <fieldset key={category} className="border rounded-3 p-3 mb-3">
              <legend className="float-none w-auto h6 mb-0 px-1">{categoryLabel(category)}</legend>
              <p className="small mb-3"><strong>Stok tercatat</strong><br />{quantityText(before)}</p>
              <p className="small fw-semibold mb-1">{method === "count" ? "Jumlah hasil hitung" : method === "add" ? "Jumlah yang ditambah" : "Jumlah yang dikurangi"}</p>
              <div className="row g-2">
                {units.map(({ key, label, unit }) => (
                  <Field key={key} className="col-6 col-sm-4" label={label}>
                    <input className="form-control" type="number" inputMode={key === "kg" ? "decimal" : "numeric"}
                      min="0" step={key === "kg" ? "0.001" : "1"} required={method === "count"} placeholder="0" value={counts[category][key]}
                      aria-label={`${categoryLabel(category)} ${unit} ${method === "count" ? "fisik" : method === "add" ? "ditambah" : "dikurangi"}`}
                      onChange={e => {
                        const value = e.target.value;
                        setCounts(all => ({ ...all, [category]: { ...all[category], [key]: value } }));
                      }} />
                  </Field>
                ))}
              </div>
              {(method !== "count" || units.every(({ key }) => counts[category][key] !== "")) && (
                <div className="border-top small mt-3 pt-2" aria-live="polite">
                  <p className="mb-1"><strong>Selisih</strong><br />{quantityText({ eggs: physical.eggs - before.eggs, kg: Number((physical.kg - before.kg).toFixed(3)), trays: physical.trays - (before.trays ?? 0) }, true)}</p>
                  <p className="mb-0"><strong>Stok setelah disimpan</strong><br />{quantityText(physical)}</p>
                </div>
              )}
            </fieldset>
          ))}
          <Field label="Alasan penyesuaian (wajib)" className="d-block">
            <textarea className="form-control" rows={2} maxLength={2000} required value={reason}
              placeholder="Contoh: 2 butir pecah saat dipindahkan." onChange={e => setReason(e.target.value)} />
          </Field>
          {(stale || conflict) && <div role="alert" className="alert alert-warning mt-3 mb-0">
            <p className="mb-2">Stok berubah selama penghitungan. Periksa saldo terbaru dan hitung kembali sebelum menyimpan.</p>
            {needsRefresh ? <button className="btn btn-light btn-sm" type="button" onClick={() => void loadLatest()}>Muat ulang stok</button> :
              <button className="btn btn-light btn-sm" type="button" onClick={() => { setExpected(snapshot(state)); setConflict(false); setError(""); }}>Bandingkan dengan stok terbaru</button>}
          </div>}
          {error && <p role="alert" className="alert alert-danger mt-3 mb-0">{error}</p>}
        </fieldset>
        <div className="modal-footer-custom">
          <button className="btn btn-light" type="button" disabled={busy} onClick={safeClose}>Batal</button>
          <LoadingButton disabled={stale || conflict} busy={busy}>Simpan penyesuaian</LoadingButton>
        </div>
      </form>
    </Dialog>
  );
}
