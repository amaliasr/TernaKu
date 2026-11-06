"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Plus, Trash2, Egg, Info } from "lucide-react";
import HarvestForm from "./HarvestForm";
import {
  isUncertainWriteError,
  shouldPreserveUnconfirmedWrite,
  useFarm,
} from "@/lib/store";
import {
  activePrice,
  eggStock,
  feedStock,
  money,
  number as formatNumber,
  today,
} from "@/lib/domain";
import type { Category, CommandPayload, Sale } from "@/lib/types";
import { findSavedSale } from "@/lib/sale-receipt";
import { availableSalePickups, saleStockIssues } from "@/lib/sale-availability";
import EmployeeEntry from "./EmployeeEntry";
import { DraftBoundary, DraftFields, useDraftField, useEntryDraft, useSaleDueDate } from "./DraftBoundary";
import { draftKey, type DraftAttempt } from "@/lib/entry-drafts";
import Photo from "./PhotoUpload";
import { SaleDetail } from "./RecordDialogs";
import {
  categoryLabel,
  dataFrom,
  Dialog,
  DialogSession,
  errorMessage,
  Field,
  LoadingButton,
  localNow,
} from "./ModuleUI";

const number = (value: number) => formatNumber(value, 3);

type FormProps = {
  onSave: (action: string, payload: CommandPayload) => Promise<void>;
  busy: boolean;
  onClose: () => void;
};
function Footer({
  busy,
  disabled,
  onClose,
  label = "Simpan data",
}: {
  busy: boolean;
  disabled?: boolean;
  onClose: () => void;
  label?: string;
}) {
  return (
    <div className="modal-footer-custom">
      <button
        type="button"
        className="btn btn-light"
        onClick={onClose}
        disabled={busy}
      >
        Batal
      </button>
      <LoadingButton busy={busy} disabled={disabled}>
        {label}
      </LoadingButton>
    </div>
  );
}
function FormShell({
  children,
  onSubmit,
  busy,
  disabled,
  onClose,
  label,
}: {
  children: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  disabled?: boolean;
  onClose: () => void;
  label?: string;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="modal-body-custom">{children}</div>
      <Footer busy={busy} disabled={disabled} onClose={onClose} label={label} />
    </form>
  );
}
function PickupForm({ onSave, busy, onClose }: FormProps) {
  const { state } = useFarm();
  const [category, setCategory] = useState<Category>("good");
  const available = eggStock(state, category);
  return (
    <FormShell
      busy={busy}
      onClose={onClose}
      label="Catat pengambilan"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("pickup.create", {
          ...data,
          date: data.date + ":00+07:00",
          category,
          eggs: Number(data.eggs),
          kg: Number(data.kg),
          trays: Number(data.trays),
        });
      }}
    >
      <div className="row g-3">
        <Field className="col-sm-6" label="Waktu pengambilan (WIB)">
          <input
            type="datetime-local"
            name="date"
            className="form-control"
            defaultValue={localNow()}
            max={localNow()}
            required
          />
        </Field>
        <Field className="col-sm-6" label="Kategori telur">
          <select
            className="form-select"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            <option value="good">Telur bagus</option>
            <option value="cracked">Telur bentes</option>
          </select>
        </Field>
      </div>
      <div className="form-summary my-3">
        <Egg size={20} />
        <span>Tersedia di gudang</span>
        <strong>
          {number(available.eggs)} butir · {number(available.kg)} kg
        </strong>
      </div>
      <div className="row g-3">
        <Field className="col-sm-4" label="Jumlah butir">
          <input
            name="eggs"
            type="number"
            step="1"
            min="1"
            max={available.eggs}
            className="form-control"
            required
          />
        </Field>
        <Field className="col-sm-4" label="Berat hasil timbangan (kg)">
          <input
            name="kg"
            type="number"
            step="0.001"
            min="0.001"
            max={available.kg}
            className="form-control"
            required
          />
        </Field>
        <Field className="col-sm-4" label="Jumlah krat">
          <input
            name="trays"
            type="number"
            step="1"
            min="0"
            defaultValue="0"
            className="form-control"
            required
          />
        </Field>
      </div>
      <Field className="d-block mt-3" label="Tujuan / area penjualan">
        <input
          name="area"
          className="form-control"
          placeholder="Contoh: Pasar Pagi, wilayah utara"
          maxLength={150}
          required
        />
      </Field>
      <Field className="d-block mt-3" label="Catatan (opsional)">
        <textarea
          name="notes"
          className="form-control"
          rows={2}
          maxLength={2000}
        />
      </Field>
      <div className="info-note mt-3">
        <Info size={17} />
        <span>
          Pengambilan dicatat atas nama Anda. Stok gudang berkurang dan menjadi
          persediaan yang Anda bawa.
        </span>
      </div>
    </FormShell>
  );
}
type SaleLine = {
  pickup_id: string;
  kg: string;
  eggs: string;
  trays: string;
  is_free: boolean;
};
function SaleForm({ onSave, busy, onClose }: FormProps) {
  const { state, user } = useFarm();
  const price = activePrice(state);
  const available = availableSalePickups(state, user?.id);
  const [items, setItems] = useDraftField<SaleLine[]>("items", [
    { pickup_id: "", kg: "", eggs: "", trays: "0", is_free: false },
  ]);
  const [method, setMethod] = useDraftField("method", "cash");
  const [isFull, setIsFull] = useDraftField("fullyPaid", true);
  const [paid, setPaid] = useDraftField("paid", "");
  const [dueDate, setDueDate] = useSaleDueDate();
  const [photo, setPhoto] = useDraftField("photo", "");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [reviewedPriceId, setReviewedPriceId] = useDraftField("reviewedPriceId", price?.id);
  const stockIssues = saleStockIssues(items, available);
  const showTotal = !!price && stockIssues.size === 0 && items.every(item => item.pickup_id);
  const needsPriceReview = !!price && reviewedPriceId !== price.id && items.some(line => line.kg !== "" || line.eggs !== "");
  const linePrice = (line: SaleLine) => {
    const pickup = available.find((p) => p.id === line.pickup_id);
    if (!pickup) return 0;
    if (
      pickup?.category === "cracked" &&
      (line.is_free || price?.cracked_price === 0)
    )
      return 0;
    return pickup?.category === "good"
      ? price?.good_price || 0
      : price?.cracked_price || 0;
  };
  const total = items.reduce(
      (sum, item) => sum + Math.round(Number(item.kg) * linePrice(item)),
      0,
    ),
    payment = total === 0 ? 0 : isFull ? total : Number(paid);
  const hasFree = items.some(
    (line) =>
      available.find((p) => p.id === line.pickup_id)?.category ===
        "cracked" &&
      (line.is_free || price?.cracked_price === 0),
  );
  const update = (
    index: number,
    key: keyof SaleLine,
    value: string | boolean,
  ) =>
    setItems((old) =>
      old.map((line, i) => (i === index ? { ...line, ...(key === "pickup_id" ? {is_free: false} : {}), [key]: value } : line)),
    );
  if (!available.length)
    return (
      <div className="modal-body-custom">
        <div className="empty-state">
          <Egg size={36} />
          <h3>Belum ada telur yang dibawa</h3>
          {stockIssues.size > 0 && <p className="alert alert-warning">Pengambilan pada draf ini sudah habis. Setelah mengambil telur lagi, buka draf dan pilih pengambilan yang baru.</p>}
          <p>
            Catat pengambilan telur terlebih dahulu melalui menu Stok Telur.
            Penjualan harus berasal dari persediaan milik Anda.
          </p>
          <button className="btn btn-primary" onClick={onClose}>
            Mengerti
          </button>
        </div>
      </div>
    );
  return (
    <FormShell
      busy={busy}
      disabled={!showTotal || photoBusy || !photo || needsPriceReview}
      onClose={onClose}
      label={photoBusy ? "Memproses foto…" : "Simpan penjualan"}
      onSubmit={(e) => {
        e.preventDefault();
        if (photoBusy || !photo || !showTotal || needsPriceReview) return;
        const data = dataFrom(e.currentTarget);
        void onSave("sale.create", {
          ...data,
          date: data.date + ":00+07:00",
          expected_price_id: price?.id,
          items: items.map((item) => ({
            pickup_id: item.pickup_id,
            category: available.find((p) => p.id === item.pickup_id)
              ?.category,
            kg: Number(item.kg),
            eggs: Number(item.eggs),
            trays: Number(item.trays),
            is_free:
              available.find((p) => p.id === item.pickup_id)?.category ===
                "cracked" &&
              (item.is_free || price?.cracked_price === 0),
          })),
          payment_method: total === 0 ? "cash" : method,
          paid: payment,
          due_date: payment < total ? dueDate : undefined,
          photo: photo || undefined,
        });
      }}
    >
      <div className="row g-3">
        <Field className="col-sm-6" label="Waktu transaksi (WIB)">
          <input
            name="date"
            type="datetime-local"
            className="form-control"
            defaultValue={localNow()}
            max={localNow()}
            required
          />
        </Field>
        <Field
          className="col-sm-6"
          label={
            hasFree ? "Nama penerima telur gratis (wajib)" : "Nama pelanggan (wajib)"
          }
        >
          <input
            name="customer"
            className="form-control"
            placeholder="Nama pelanggan"
            maxLength={150}
            pattern={".*\\S.*"}
            title="Isi nama pelanggan, bukan hanya spasi."
            required
          />
        </Field>
        <Field className="col-sm-6" label="Telepon pelanggan (opsional)">
          <input
            name="phone"
            type="tel"
            className="form-control"
            placeholder="08…"
            maxLength={30}
          />
        </Field>
        <Field className="col-sm-6" label="Penjual">
          <input className="form-control" disabled value={user?.name || ""} />
        </Field>
      </div>
      <div className="form-section">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="mb-0">Item penjualan</h3>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={() =>
              setItems((old) => [
                ...old,
                { pickup_id: "", kg: "", eggs: "", trays: "0", is_free: false },
              ])
            }
            disabled={items.length >= 100}
          >
            <Plus size={14} />
            Tambah item
          </button>
        </div>
        {items.map((item, index) => {
          const pickup = available.find((p) => p.id === item.pickup_id),
            balance = pickup?.balance;
          const issue = stockIssues.get(item.pickup_id);
          return (
            <div className="sale-line" key={index}>
              <div className="d-flex gap-2 align-items-end">
                <Field
                  className="flex-grow-1"
                  label={`Pengambilan ${index + 1}`}
                >
                  <select
                    className="form-select"
                    value={pickup?.id || ""}
                    onChange={(e) => update(index, "pickup_id", e.target.value)}
                    required
                  >
                    <option value="">Pilih persediaan Anda</option>
                    {available.map((p) => (
                      <option key={p.id} value={p.id}>
                        {categoryLabel(p.category)} · {p.area} ·{" "}
                        {number(p.balance.kg)} kg
                      </option>
                    ))}
                  </select>
                </Field>
                {items.length > 1 && (
                  <button
                    className="icon-btn mb-1"
                    type="button"
                    aria-label={`Hapus item ${index + 1}`}
                    onClick={() =>
                      setItems((old) => old.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
              {issue && <p className="alert alert-warning my-2" role="alert">{issue}</p>}
              {balance && (
                <small className="text-muted d-block my-2">
                  Tersedia {number(balance.eggs)} butir / {number(balance.kg)}{" "}
                  kg · Harga {money(linePrice(item))}/kg
                </small>
              )}
              {pickup?.category === "cracked" && (
                <label
                  className="form-check d-flex align-items-center gap-2 my-2"
                  style={{ minHeight: 48 }}
                >
                  <input
                    className="form-check-input m-0"
                    type="checkbox"
                    checked={item.is_free || price?.cracked_price === 0}
                    disabled={price?.cracked_price === 0}
                    onChange={(e) => update(index, "is_free", e.target.checked)}
                  />
                  <span>
                    Gratis (pemberian telur bentes)
                    {price?.cracked_price === 0 && (
                      <small className="d-block text-muted">
                        Harga bentes hari ini ditetapkan gratis.
                      </small>
                    )}
                  </span>
                </label>
              )}
              <div className="row g-2 mt-1">
                <Field className="col-4" label="Butir">
                  <input
                    className="form-control"
                    type="number"
                    min="1"
                    step="1"
                    max={balance?.eggs}
                    value={item.eggs}
                    onChange={(e) => update(index, "eggs", e.target.value)}
                    required
                  />
                </Field>
                <Field className="col-4" label="Berat (kg)">
                  <input
                    className="form-control"
                    type="number"
                    min="0.001"
                    step="0.001"
                    max={balance?.kg}
                    value={item.kg}
                    onChange={(e) => update(index, "kg", e.target.value)}
                    required
                  />
                </Field>
                <Field className="col-4" label="Krat">
                  <input
                    className="form-control"
                    type="number"
                    min="0"
                    step="1"
                    value={item.trays}
                    onChange={(e) => update(index, "trays", e.target.value)}
                    required
                  />
                </Field>
              </div>
              <div className="text-end mt-2 fw-semibold">
                {!price || !pickup || issue ? "—" : pickup.category === "cracked" &&
                (item.is_free || price?.cracked_price === 0)
                  ? "Gratis"
                  : money(Math.round(Number(item.kg) * linePrice(item)))}
              </div>
            </div>
          );
        })}
        <div className="info-note">
          <Info size={16} />
          <span>
            Harga mengikuti ketetapan atasan saat penjualan disimpan.
            Perubahan harga berikutnya tidak mengubah penjualan ini.
          </span>
        </div>
        {showTotal && needsPriceReview && <div className="alert alert-warning" role="alert">Harga dari atasan berubah. Total baru: <strong>{money(total)}</strong>. <button type="button" className="btn btn-warning" onClick={() => setReviewedPriceId(price?.id)}>Gunakan harga baru</button></div>}
        {!price && (
          <div className="alert alert-warning mt-2">
            Belum ada harga aktif. Minta atasan menetapkan harga sebelum
            mencatat penjualan.
          </div>
        )}
      </div>
      {hasFree && (
        <div className="alert alert-info">
          Telur gratis tetap mengurangi persediaan. Nama penerima wajib diisi.
          {total === 0 && " Tidak ada pembayaran atau piutang."}
        </div>
      )}
      <div className="row g-3" hidden={hasFree && total === 0}>
        <Field className="col-sm-6" label="Metode pembayaran">
          <select
            className="form-select"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value);
              if (e.target.value === "credit") {
                setIsFull(false);
                setPaid("0");
              }
            }}
          >
            <option value="cash">Tunai</option>
            <option value="transfer">Transfer</option>
            <option value="qris">QRIS</option>
            <option value="credit">Piutang</option>
          </select>
        </Field>
        <Field className="col-sm-6" label="Status pembayaran">
          <select
            className="form-select"
            value={isFull ? "paid" : "other"}
            onChange={(e) => setIsFull(e.target.value === "paid")}
          >
            <option value="paid">Lunas</option>
            <option value="other">Belum / sebagian dibayar</option>
          </select>
        </Field>
        {!isFull && total > 0 && (
          <Field className="col-12" label="Nominal dibayar (Rp)">
            <input
              type="number"
              className="form-control"
              min="0"
              max={total}
              step="1"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              required
            />
          </Field>
        )}
      </div>
      {payment < total && (
        <Field className="d-block mt-3" label="Jatuh tempo pelanggan" hint="Pilih tanggal yang disepakati untuk melunasi sisa tagihan.">
          <input type="date" name="due_date" data-draft-controlled className="form-control" value={dueDate} onChange={e => setDueDate(e.target.value)} required />
        </Field>
      )}
      <div className="invoice-summary mt-3">
        <div>
          <span>Total penjualan</span>
          <strong>{showTotal ? money(total) : "—"}</strong>
        </div>
        <div>
          <span>Nominal dibayar</span>
          <span>{showTotal ? money(payment) : "—"}</span>
        </div>
        <div>
          <span>Sisa tagihan</span>
          <strong>{showTotal ? money(Math.max(0, total - payment)) : "—"}</strong>
        </div>
      </div>
      <Field className="d-block mt-3" label="Catatan (opsional)">
        <textarea
          name="notes"
          className="form-control"
          rows={2}
          maxLength={2000}
        />
      </Field>
      <Photo label="Foto dokumentasi penjualan" optional={false} value={photo} onChange={setPhoto} onBusyChange={setPhotoBusy} disabled={busy} />
      <p className="small text-muted mt-2">Nama pelanggan dan foto dokumentasi wajib diisi, termasuk untuk telur gratis. Ambil foto langsung atau pilih dari galeri.</p>
    </FormShell>
  );
}
function PriceForm({ onSave, busy, onClose }: FormProps) {
  const { state } = useFarm();
  const price = activePrice(state);
  return (
    <FormShell
      busy={busy}
      onClose={onClose}
      label="Simpan harga"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("price.create", {
          good_price: Number(data.good_price),
          cracked_price: Number(data.cracked_price),
          effective_at: `${data.effective_at}:00+07:00`,
        });
      }}
    >
      <div className="row g-3">
        <Field className="col-sm-6" label="Telur bagus (Rp/kg)">
          <input
            name="good_price"
            className="form-control"
            type="number"
            min="1"
            step="1"
            defaultValue={price?.good_price}
            required
          />
        </Field>
        <Field
          className="col-sm-6"
          label="Telur bentes (Rp/kg)"
          hint="Isi 0 jika telur bentes diberikan gratis."
        >
          <input
            name="cracked_price"
            className="form-control"
            type="number"
            min="0"
            step="1"
            defaultValue={price?.cracked_price}
            required
          />
        </Field>
        <Field
          className="col-12"
          label="Mulai berlaku (WIB)"
          hint="Harga untuk tanggal mendatang akan aktif sesuai jadwal."
        >
          <input
            name="effective_at"
            type="datetime-local"
            className="form-control"
            defaultValue={localNow()}
            required
          />
        </Field>
      </div>
      <div className="info-note mt-4">
        <Info size={19} />
        <span>
          Seluruh karyawan menerima notifikasi perubahan harga. Harga pada
          transaksi yang sudah tercatat tetap tersimpan.
        </span>
      </div>
    </FormShell>
  );
}
function UserForm({ onSave, busy, onClose }: FormProps) {
  return (
    <FormShell
      busy={busy}
      onClose={onClose}
      label="Buat akun"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("user.create", { ...data, target: Number(data.target) });
      }}
    >
      <div className="row g-3">
        <Field className="col-12" label="Nama lengkap">
          <input
            name="name"
            className="form-control"
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
          />
        </Field>
        <Field className="col-12" label="Email">
          <input
            type="email"
            name="email"
            className="form-control"
            required
            autoComplete="off"
            maxLength={150}
          />
        </Field>
        <Field
          className="col-12"
          label="Kata sandi"
          hint="Minimal 10 karakter. Sampaikan langsung kepada pemilik akun."
        >
          <input
            type="password"
            name="password"
            className="form-control"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
          />
        </Field>
        <Field className="col-sm-6" label="Peran">
          <select name="role" className="form-select">
            <option value="employee">Karyawan</option>
            <option value="admin">Atasan / Admin</option>
          </select>
        </Field>
        <Field className="col-sm-6" label="Target omzet bulanan (Rp)">
          <input
            type="number"
            name="target"
            min="0"
            step="1"
            className="form-control"
            defaultValue="5000000"
            required
          />
        </Field>
      </div>
    </FormShell>
  );
}
function BarnForm({ onSave, busy, onClose }: FormProps) {
  return (
    <FormShell
      busy={busy}
      onClose={onClose}
      label="Tambah kandang ayam"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("barn.create", {
          ...data,
          type: "ayam",
          capacity: Number(data.capacity),
        });
      }}
    >
      <Field className="d-block" label="Nama / kelompok kandang ayam">
        <input
          name="name"
          className="form-control"
          required
          maxLength={100}
          placeholder="Kandang ayam A"
        />
      </Field>
      <Field className="d-block mt-3" label="Kapasitas ayam (ekor)">
        <input
          name="capacity"
          type="number"
          className="form-control"
          min="0"
          step="1"
          defaultValue="0"
          required
        />
      </Field>
      <Field className="d-block mt-3" label="Catatan">
        <textarea
          name="notes"
          className="form-control"
          rows={2}
          maxLength={2000}
        />
      </Field>
    </FormShell>
  );
}
function FeedCreateForm({ onSave, busy, onClose }: FormProps) {
  return (
    <FormShell
      busy={busy}
      onClose={onClose}
      label="Tambah jenis pakan"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("feed.create", {
          ...data,
          unit: "kg",
          min_stock: Number(data.min_stock),
        });
      }}
    >
      <Field className="d-block" label="Nama pakan">
        <input
          name="name"
          className="form-control"
          required
          maxLength={100}
          placeholder="Contoh: Konsentrat layer"
        />
      </Field>
      <Field
        className="d-block mt-3"
        label="Batas stok minimum (kg)"
        hint="Pakan dengan stok di bawah batas ini akan diberi penanda."
      >
        <input
          name="min_stock"
          type="number"
          className="form-control"
          min="0"
          step="0.001"
          defaultValue="50"
          required
        />
      </Field>
      <div className="info-note mt-3">
        <Info size={17} />
        <span>
          Stok awal nol. Catat pembelian untuk menambah persediaan pakan.
        </span>
      </div>
    </FormShell>
  );
}
function FeedUseForm({ onSave, busy, onClose }: FormProps) {
  const { state } = useFarm();
  const [feed, setFeed] = useState(state.feeds[0]?.id || "");
  const stock = feedStock(state, feed);
  return (
    <FormShell
      busy={busy}
      onClose={onClose}
      label="Catat pemakaian"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("feed.use", {
          ...data,
          feed_id: feed,
          quantity: Number(data.quantity),
        });
      }}
    >
      <div className="row g-3">
        <Field className="col-sm-6" label="Tanggal pemakaian">
          <input
            type="date"
            name="date"
            className="form-control"
            defaultValue={today()}
            max={today()}
            required
          />
        </Field>
        <Field className="col-sm-6" label="Kandang penerima">
          <select name="barn_id" className="form-select" required>
            <option value="">Pilih kandang ayam</option>
            {state.barns.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field className="col-12" label="Jenis pakan">
          <select
            className="form-select"
            value={feed}
            onChange={(e) => setFeed(e.target.value)}
            required
          >
            {!state.feeds.length && (
              <option value="">Belum ada jenis pakan</option>
            )}
            {state.feeds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          className="col-12"
          label="Jumlah pemakaian (kg)"
          hint={`Stok tersedia: ${number(stock)} kg`}
        >
          <input
            type="number"
            name="quantity"
            className="form-control"
            min="0.001"
            step="0.001"
            max={stock}
            required
          />
        </Field>
        <Field className="col-12" label="Catatan (opsional)">
          <textarea
            name="notes"
            className="form-control"
            rows={2}
            maxLength={2000}
          />
        </Field>
      </div>
    </FormShell>
  );
}
function FeedPurchaseForm({ onSave, busy, onClose }: FormProps) {
  const { state } = useFarm();
  const [items, setItems] = useState([
    { feed_id: state.feeds[0]?.id || "", quantity: "", unit_price: "" },
  ]);
  const [full, setFull] = useState(true);
  const [paid, setPaid] = useState("0");
  const total = items.reduce(
    (sum, item) =>
      sum + Math.round(Number(item.quantity) * Number(item.unit_price)),
    0,
  );
  return (
    <FormShell
      busy={busy}
      onClose={onClose}
      label="Simpan pembelian"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("feed.purchase", {
          ...data,
          items: items.map((i) => ({
            feed_id: i.feed_id,
            quantity: Number(i.quantity),
            unit_price: Number(i.unit_price),
          })),
          paid: full ? total : Number(paid),
        });
      }}
    >
      <div className="row g-3">
        <Field className="col-sm-6" label="Tanggal pembelian">
          <input
            type="date"
            name="date"
            className="form-control"
            defaultValue={today()}
            max={today()}
            required
          />
        </Field>
        <Field className="col-sm-6" label="Pemasok">
          <input
            name="supplier"
            className="form-control"
            placeholder="Nama toko / pemasok"
            maxLength={150}
            required
          />
        </Field>
      </div>
      <div className="form-section">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="mb-0">Rincian pakan</h3>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={() =>
              setItems((old) => [
                ...old,
                { feed_id: "", quantity: "", unit_price: "" },
              ])
            }
          >
            <Plus size={14} />
            Tambah item
          </button>
        </div>
        {items.map((item, index) => (
          <div className="sale-line" key={index}>
            <div className="d-flex align-items-end gap-2">
              <Field className="flex-grow-1" label={`Jenis pakan ${index + 1}`}>
                <select
                  className="form-select"
                  value={item.feed_id}
                  onChange={(e) =>
                    setItems((old) =>
                      old.map((v, i) =>
                        i === index ? { ...v, feed_id: e.target.value } : v,
                      ),
                    )
                  }
                  required
                >
                  <option value="">Pilih pakan</option>
                  {state.feeds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Field>
              {items.length > 1 && (
                <button
                  type="button"
                  className="icon-btn mb-1"
                  aria-label={`Hapus pakan ${index + 1}`}
                  onClick={() =>
                    setItems((old) => old.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
            <div className="row g-2 mt-1">
              <Field className="col-6" label="Jumlah (kg)">
                <input
                  className="form-control"
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={item.quantity}
                  onChange={(e) =>
                    setItems((old) =>
                      old.map((v, i) =>
                        i === index ? { ...v, quantity: e.target.value } : v,
                      ),
                    )
                  }
                  required
                />
              </Field>
              <Field className="col-6" label="Harga / kg (Rp)">
                <input
                  className="form-control"
                  type="number"
                  step="1"
                  min="1"
                  value={item.unit_price}
                  onChange={(e) =>
                    setItems((old) =>
                      old.map((v, i) =>
                        i === index ? { ...v, unit_price: e.target.value } : v,
                      ),
                    )
                  }
                  required
                />
              </Field>
            </div>
            <div className="text-end fw-semibold mt-2">
              {money(
                Math.round(Number(item.quantity) * Number(item.unit_price)),
              )}
            </div>
          </div>
        ))}
        {!state.feeds.length && (
          <div className="alert alert-warning">
            Tambahkan jenis pakan melalui menu Pakan sebelum mencatat pembelian.
          </div>
        )}
      </div>
      <div className="form-check mb-3">
        <input
          className="form-check-input"
          type="checkbox"
          id="purchase-full"
          checked={full}
          onChange={(e) => setFull(e.target.checked)}
        />
        <label htmlFor="purchase-full" className="form-check-label">
          Pembelian sudah lunas
        </label>
      </div>
      {!full && Number(paid) < total && (
        <Field className="d-block mb-3" label="Jatuh tempo ke pemasok">
          <input type="date" name="due_date" className="form-control" required />
        </Field>
      )}
      {!full && (
        <Field className="d-block mb-3" label="Nominal dibayar (Rp)">
          <input
            className="form-control"
            type="number"
            min="0"
            step="1"
            max={total}
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            required
          />
        </Field>
      )}
      <div className="invoice-summary">
        <div>
          <span>Total pembelian</span>
          <strong>{money(total)}</strong>
        </div>
        <div>
          <span>Sisa pembayaran</span>
          <span>
            {money(Math.max(0, total - (full ? total : Number(paid))))}
          </span>
        </div>
      </div>
      <Field className="d-block mt-3" label="Catatan (opsional)">
        <textarea
          name="notes"
          className="form-control"
          rows={2}
          maxLength={2000}
        />
      </Field>
    </FormShell>
  );
}
const config: Record<
  string,
  { title: string; subtitle: string; form: (props: FormProps) => ReactNode }
> = {
  production: {
    title: "Catat panen telur",
    subtitle: "Panen hari ini, tercatat dengan rapi.",
    form: HarvestForm,
  },
  pickup: {
    title: "Pengambilan telur",
    subtitle: "Catat telur yang dibawa untuk dijual.",
    form: PickupForm,
  },
  sale: {
    title: "Catat penjualan",
    subtitle: "Harga otomatis, transaksi lebih praktis.",
    form: SaleForm,
  },
  price: {
    title: "Perbarui harga telur",
    subtitle: "Atur harga per kilogram dan waktu berlakunya.",
    form: PriceForm,
  },
  user: {
    title: "Tambah karyawan",
    subtitle: "Buat akun untuk karyawan baru.",
    form: UserForm,
  },
  barn: {
    title: "Tambah kandang ayam",
    subtitle: "Kelompokkan sumber produksi dan pemakaian pakan.",
    form: BarnForm,
  },
  "feed.create": {
    title: "Jenis pakan baru",
    subtitle: "Tambahkan jenis pakan yang digunakan.",
    form: FeedCreateForm,
  },
  "feed.purchase": {
    title: "Pembelian pakan",
    subtitle: "Catat belanja pakan beserta nota pembeliannya.",
    form: FeedPurchaseForm,
  },
  "feed.use": {
    title: "Pemakaian pakan",
    subtitle: "Alokasikan pakan ke kandang yang tepat.",
    form: FeedUseForm,
  },
};
type UnconfirmedSale = DraftAttempt;
const unconfirmedSaleKey = (userId: string) =>
  `ternaku.sale.unconfirmed.v1.${userId}`;
function readUnconfirmedSale(userId: string): UnconfirmedSale | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(unconfirmedSaleKey(userId)) || "null",
    ) as UnconfirmedSale | null;
    return value?.user_id === userId &&
      typeof value.request_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.request_id,
      ) &&
      value.action === "sale.create" &&
      value.payload &&
      typeof value.payload === "object" &&
      !Array.isArray(value.payload)
      ? value
      : null;
  } catch {
    return null;
  }
}
type EntryProps = { kind: string | null; onClose: () => void; onSaved?: (action: string) => void };
export function EntryModal(props: EntryProps) {
  const { user, mode } = useFarm();
  const kind = props.kind;
  if (user && (kind === "production" || kind === "sale")) {
    const scope = draftKey(mode, user.id, kind);
    return <DialogSession key={scope} onClose={props.onClose}>
      <DraftBoundary storageKey={scope} label={kind === "sale" ? "penjualan" : "panen"} onClose={props.onClose}>
        <EntryBody {...props} />
      </DraftBoundary>
    </DialogSession>;
  }
  return <EntryBody {...props} />;
}
function EntryBody({kind, onClose, onSaved}: EntryProps) {
  const { command, user, refresh, mode, state } = useFarm();
  const draft = useEntryDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedSale, setSavedSale] = useState<{ sale: Sale | null } | null>(null);
  const savingRef = useRef(false);
  const [employeeKind, setEmployeeKind] = useState<"pickup" | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSale | null>(() =>
    draft?.writer.record.attempt || (mode === "live" && user && kind === "sale" ? readUnconfirmedSale(user.id) : null),
  );
  const errorRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setEmployeeKind(null);
    setError("");
    setSavedSale(null);
  }, [kind]);
  useEffect(() => {
    if (unconfirmed) retryRef.current?.focus();
    else if (error) errorRef.current?.focus();
  }, [error, unconfirmed]);
  if (!kind || !config[kind]) return null;
  const simple =
    user?.role === "employee" &&
    ["production", "pickup", "sale"].includes(kind);
  const shownKind = simple ? employeeKind || kind : kind;
  const { title, subtitle, form: Form } = config[shownKind];
  const adminOnly = [
    "price",
    "user",
    "barn",
    "feed.create",
    "feed.purchase",
  ].includes(kind);
  const clearUnconfirmed = () => {
    if (user && kind === "sale") {
      try {
        sessionStorage.removeItem(unconfirmedSaleKey(user.id));
      } catch {
        /* Browsers with unavailable storage already reject the API command's retry key. */
      }
    }
    setUnconfirmed(null);
  };
  const close = () => {
    if (busy || savingRef.current) return false;
    if (
      unconfirmed &&
      !window.confirm(
        "Belum ada kepastian dari server. Data dan nomor percobaan tersimpan di HP ini. Tutup sekarang?",
      )
    )
      return false;
    setError("");
    onClose();
  };
  const save = async (
    requestedAction: string,
    requestedPayload: CommandPayload,
  ) => {
    if (savingRef.current || savedSale) return;
    const action = unconfirmed?.action || requestedAction;
    const payload = unconfirmed?.payload || requestedPayload;
    const isDraftAction = action === "sale.create" || action === "production.create";
    if (mode === "live" && isDraftAction && !navigator.onLine) {
      setError("HP sedang offline. Sambungkan internet, lalu coba simpan kembali."); return;
    }
    let attempt = unconfirmed;
    let succeeded = false;
    let sending = false;
    let confirmedSale: Sale | null = null;
    const previousSaleIds = Array.isArray(attempt?.previous_sale_ids)
      ? attempt.previous_sale_ids.filter((id) => typeof id === "string")
      : attempt || action !== "sale.create" || state.price_cursor !== undefined
        ? undefined
        : state.sales
            .filter((sale) => sale.user_id === user?.id)
            .map((sale) => sale.id);
    savingRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (user && isDraftAction && !attempt) {
        const snapshot = state.prices.find(
          (price) => price.id === payload.expected_price_id,
        );
        const lines = Array.isArray(payload.items)
          ? (payload.items as {
              kg: number;
              category: Category;
              is_free?: boolean;
            }[])
          : [];
        attempt = {
          user_id: user.id,
          request_id: crypto.randomUUID(),
          action,
          ...(action === "sale.create" ? { previous_sale_ids: previousSaleIds } : {}),
          payload: JSON.parse(JSON.stringify(payload)) as CommandPayload,
          total: snapshot
            ? lines.reduce(
                (sum, item) =>
                  sum +
                  Math.round(
                    item.kg *
                      (item.category === "cracked" && item.is_free
                        ? 0
                        : item.category === "good"
                          ? snapshot.good_price
                          : snapshot.cracked_price),
                  ),
                0,
              )
            : null,
        };
      }
      if (attempt && draft) {
        await draft.writer.pending(attempt);
      }
      sending = true;
      const confirmed = await command(action, payload, attempt?.request_id);
      if (action === "sale.create") {
        confirmedSale = user
          ? findSavedSale(
              confirmed,
              user.id,
              payload,
              attempt?.request_id,
              previousSaleIds,
            )
          : null;
      }
      if (isDraftAction && draft) {
        // If cleanup is interrupted, the frozen request is still safe to replay.
        await draft.writer.finish().catch(() => {});
        clearUnconfirmed();
      }
      succeeded = true;
    } catch (e) {
      setError(
        !sending && !unconfirmed && !errorMessage(e).includes("tab lain")
          ? "Data belum dikirim. Penyimpanan perangkat tidak tersedia atau penuh. Kosongkan ruang, lalu coba lagi."
          : errorMessage(e),
      );
      if (
        attempt &&
        (unconfirmed
          ? shouldPreserveUnconfirmedWrite(e)
          : sending && isUncertainWriteError(e))
      ) {
        setUnconfirmed(attempt);
        return;
      }
      if (isDraftAction && draft) {
        clearUnconfirmed();
        if (sending) {
          await draft.writer.pending(null).catch(() => {});
        } else if (!unconfirmed) draft.writer.record.attempt = null;
      }
      if (
        action === "sale.create" &&
        /harga|stok|dibawa|sisa|pengambilan/i.test(errorMessage(e))
      ) {
        try {
          await refresh();
        } catch {
          /* Retain the original validation error and entered form values. */
        }
      }
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
    if (succeeded) {
      onSaved?.(action);
      if (action === "sale.create") {
        setSavedSale({ sale: confirmedSale });
        return;
      }
      onClose();
    }
  };
  if (savedSale) {
    if (savedSale.sale)
      return <SaleDetail sale={savedSale.sale} saved onClose={onClose} />;
    return (
      <Dialog title="Penjualan sudah tersimpan" onClose={onClose}>
        <div className="modal-body-custom" role="status">
          <p>Penjualan berhasil disimpan. Anda tidak perlu menyimpannya lagi.</p>
          <p className="mb-0">
            Buka catatan penjualan untuk melihat dan mengunduh nota.
          </p>
        </div>
        <div className="modal-footer-custom">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Selesai
          </button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      title={
        simple
          ? {
              production: "Catat panen",
              pickup: "Ambil telur dari gudang",
              sale: "Catat penjualan",
            }[shownKind] || title
          : title
      }
      subtitle={
        simple ? "Isi jumlah butir dan berat hasil timbangan." : subtitle
      }
      onClose={close}
      wide={!simple && (kind === "sale" || kind === "feed.purchase")}
    >
      {unconfirmed && (
        <div
          ref={retryRef}
          tabIndex={-1}
          className="alert alert-warning m-3"
          role="alert"
        >
          <strong>{unconfirmed.action === "sale.create" ? "Penjualan" : "Panen"} belum dipastikan tersimpan</strong>
          <p className="mt-2 mb-2">
            Coba lagi dengan data yang sama. Nomor percobaan tetap sama agar catatan tidak terhitung dua kali.
          </p>
          {unconfirmed.total !== null && Number.isFinite(unconfirmed.total) && (
            <p className="mb-2">
              Total yang dikirim: <strong>{money(unconfirmed.total)}</strong>
            </p>
          )}
          {error && <p className="small mb-3">{error}</p>}
          <div className="d-grid gap-2">
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 48 }}
              disabled={busy}
              onClick={() => {
                void save(unconfirmed.action, unconfirmed.payload);
              }}
            >
              {busy
                ? "Memeriksa dan menyimpan…"
                : "Coba lagi dengan data yang sama"}
            </button>
            <button
              type="button"
              className="btn btn-light"
              style={{ minHeight: 48 }}
              disabled={busy}
              onClick={close}
            >
              Tutup dan periksa riwayat
            </button>
          </div>
        </div>
      )}
      {error && !unconfirmed && (
        <div
          ref={errorRef}
          tabIndex={-1}
          className="alert alert-danger mx-4 mt-3 mb-0"
          role="alert"
        >
          {error}
        </div>
      )}
      <fieldset
        disabled={!!unconfirmed}
        hidden={!!unconfirmed}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <DraftFields enabled={shownKind === "sale" || shownKind === "production"}>
        {adminOnly && user?.role !== "admin" ? (
          <div className="modal-body-custom">
            <div className="alert alert-warning">
              Fitur ini hanya tersedia untuk atasan.
            </div>
          </div>
        ) : simple ? (
          <EmployeeEntry
            key={shownKind}
            kind={shownKind as "production" | "pickup" | "sale"}
            onSave={save}
            busy={busy}
            onClose={close}
            onSwitchKind={(nextKind) => {
              setError("");
              setEmployeeKind(nextKind);
            }}
          />
        ) : (
          <Form key={kind} onSave={save} busy={busy} onClose={close} />
        )}
        </DraftFields>
      </fieldset>
    </Dialog>
  );
}
export default EntryModal;
