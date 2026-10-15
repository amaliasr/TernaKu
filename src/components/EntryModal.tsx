"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Plus,
  Trash2,
  AlertTriangle,
  MapPin,
  ImagePlus,
  Egg,
  Info,
} from "lucide-react";
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
  pickupBalance,
  today,
} from "@/lib/domain";
import type { Category, CommandPayload } from "@/lib/types";
import EmployeeEntry from "./EmployeeEntry";
import {
  categoryLabel,
  dataFrom,
  Dialog,
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
function Photo({
  onChange,
  label = "Foto dokumentasi",
}: {
  onChange: (data: string) => void;
  label?: string;
}) {
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="photo-upload">
      <label>
        <ImagePlus size={18} />
        <span>
          {label} <small>(opsional, JPG/PNG/WebP, maks. 1 MB)</small>
        </span>
        <input
          aria-label={label}
          className="form-control mt-2"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setError("");
            if (!file) {
              setPhoto("");
              onChange("");
              return;
            }
            if (
              file.size > 1048576 ||
              !["image/jpeg", "image/png", "image/webp"].includes(file.type)
            ) {
              setError(
                "Gunakan gambar JPG, PNG, atau WebP berukuran maksimal 1 MB.",
              );
              e.target.value = "";
              setPhoto("");
              onChange("");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const data = String(reader.result);
              setPhoto(data);
              onChange(data);
            };
            reader.onerror = () => setError("Foto tidak dapat dibaca.");
            reader.readAsDataURL(file);
          }}
        />
      </label>
      {error && (
        <small role="alert" className="text-danger">
          {error}
        </small>
      )}
      {photo && (
        <img
          className="photo-preview"
          src={photo}
          alt="Pratinjau dokumentasi"
        />
      )}
    </div>
  );
}
function ProductionForm({ onSave, busy, onClose }: FormProps) {
  const { state, user } = useFarm();
  const [kg, setKg] = useState("");
  const [eggs, setEggs] = useState("");
  const [trays, setTrays] = useState("");
  const [photo, setPhoto] = useState("");
  const [location, setLocation] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const estimate = Number(trays) * 10,
    difference =
      estimate > 0 && Math.abs(Number(kg) - estimate) / estimate > 0.3;
  return (
    <FormShell
      busy={busy}
      onClose={onClose}
      label="Simpan produksi"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("production.create", {
          ...data,
          kg: Number(kg),
          eggs: Number(eggs),
          trays: Number(trays),
          photo: photo || undefined,
          location: location || undefined,
        });
      }}
    >
      <div className="row g-3">
        <Field className="col-sm-6" label="Tanggal produksi">
          <input
            name="date"
            className="form-control"
            type="date"
            defaultValue={today()}
            max={today()}
            required
          />
        </Field>
        <Field className="col-sm-6" label="Karyawan pencatat">
          <input className="form-control" value={user?.name || ""} disabled />
        </Field>
        <Field className="col-sm-6" label="Sumber kandang (opsional)">
          <select name="barn_id" className="form-select">
            <option value="">Tanpa kelompok kandang</option>
            {state.barns.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field className="col-sm-6" label="Kategori telur">
          <select name="category" className="form-select">
            <option value="good">Telur bagus</option>
            <option value="cracked">Telur bentes</option>
          </select>
        </Field>
        <Field className="col-sm-4" label="Jumlah butir">
          <input
            className="form-control"
            type="number"
            min="1"
            step="1"
            placeholder="0"
            value={eggs}
            onChange={(e) => setEggs(e.target.value)}
            required
          />
        </Field>
        <Field className="col-sm-4" label="Berat aktual (kg)">
          <input
            className="form-control"
            type="number"
            min="0.001"
            step="0.001"
            placeholder="0,00"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            required
          />
        </Field>
        <Field className="col-sm-4" label="Jumlah krat">
          <input
            className="form-control"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            value={trays}
            onChange={(e) => setTrays(e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="info-note mt-3">
        <Info size={17} />
        <span>
          Estimasi {number(estimate)} kg dari {Number(trays) || 0} krat. Berat
          aktual tetap menjadi dasar stok dan penjualan.
        </span>
      </div>
      {difference && Number(kg) > 0 && (
        <div className="alert alert-warning mt-3 d-flex gap-2">
          <AlertTriangle size={18} />
          <small>
            Berat aktual berbeda lebih dari 30% dari estimasi. Periksa kembali;
            data tetap dapat disimpan.
          </small>
        </div>
      )}
      <div className="form-summary mt-3">
        <Egg size={21} />
        <span>Total pencatatan</span>
        <strong>
          {number(Number(eggs))} butir · {number(Number(kg))} kg
        </strong>
      </div>
      <Field className="d-block mt-3" label="Catatan (opsional)">
        <textarea
          name="notes"
          className="form-control"
          rows={2}
          placeholder="Tambahkan informasi panen hari ini…"
          maxLength={2000}
        />
      </Field>
      <Photo onChange={setPhoto} />
      <div className="mt-3">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          disabled={locating}
          onClick={() => {
            setLocating(true);
            setLocationError("");
            if (!navigator.geolocation) {
              setLocationError("Perangkat ini tidak mendukung lokasi.");
              setLocating(false);
              return;
            }
            navigator.geolocation.getCurrentPosition(
              (p) => {
                setLocation(
                  `${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)}`,
                );
                setLocating(false);
              },
              () => {
                setLocationError(
                  "Lokasi tidak tersedia. Anda tetap dapat menyimpan produksi.",
                );
                setLocating(false);
              },
              { timeout: 10000 },
            );
          }}
        >
          <MapPin size={15} />
          {locating
            ? "Mengambil lokasi…"
            : location
              ? "Perbarui lokasi"
              : "Tambahkan lokasi (opsional)"}
        </button>
        {location && <small className="text-muted ms-2">{location}</small>}
        {locationError && (
          <small className="text-muted d-block mt-1">{locationError}</small>
        )}
      </div>
    </FormShell>
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
        <Field className="col-sm-4" label="Berat aktual (kg)">
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
type SaleLine = { pickup_id: string; kg: string; eggs: string; trays: string };
function SaleForm({ onSave, busy, onClose }: FormProps) {
  const { state, user } = useFarm();
  const price = activePrice(state);
  const available = state.pickups.filter(
    (p) =>
      p.user_id === user?.id &&
      pickupBalance(state, p).kg > 0 &&
      pickupBalance(state, p).eggs > 0,
  );
  const [items, setItems] = useState<SaleLine[]>([
    { pickup_id: "", kg: "", eggs: "", trays: "0" },
  ]);
  const [method, setMethod] = useState("cash");
  const [isFull, setIsFull] = useState(true);
  const [paid, setPaid] = useState("");
  const [photo, setPhoto] = useState("");
  const linePrice = (line: SaleLine) => {
    const pickup = state.pickups.find((p) => p.id === line.pickup_id);
    return pickup?.category === "good"
      ? price?.good_price || 0
      : price?.cracked_price || 0;
  };
  const total = items.reduce(
      (sum, item) => sum + Math.round(Number(item.kg) * linePrice(item)),
      0,
    ),
    payment = isFull ? total : Number(paid);
  const update = (index: number, key: keyof SaleLine, value: string) =>
    setItems((old) =>
      old.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    );
  if (!available.length)
    return (
      <div className="modal-body-custom">
        <div className="empty-state">
          <Egg size={36} />
          <h3>Belum ada telur yang dibawa</h3>
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
      disabled={!price}
      onClose={onClose}
      label="Simpan penjualan"
      onSubmit={(e) => {
        e.preventDefault();
        const data = dataFrom(e.currentTarget);
        void onSave("sale.create", {
          ...data,
          date: data.date + ":00+07:00",
          expected_price_id: price?.id,
          items: items.map((item) => ({
            pickup_id: item.pickup_id,
            category: state.pickups.find((p) => p.id === item.pickup_id)
              ?.category,
            kg: Number(item.kg),
            eggs: Number(item.eggs),
            trays: Number(item.trays),
          })),
          payment_method: method,
          paid: payment,
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
        <Field className="col-sm-6" label="Pelanggan (opsional)">
          <input
            name="customer"
            className="form-control"
            placeholder="Nama pelanggan"
            maxLength={150}
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
                { pickup_id: "", kg: "", eggs: "", trays: "0" },
              ])
            }
            disabled={items.length >= available.length}
          >
            <Plus size={14} />
            Tambah item
          </button>
        </div>
        {items.map((item, index) => {
          const pickup = available.find((p) => p.id === item.pickup_id),
            balance = pickup ? pickupBalance(state, pickup) : null;
          return (
            <div className="sale-line" key={index}>
              <div className="d-flex gap-2 align-items-end">
                <Field
                  className="flex-grow-1"
                  label={`Pengambilan ${index + 1}`}
                >
                  <select
                    className="form-select"
                    value={item.pickup_id}
                    onChange={(e) => update(index, "pickup_id", e.target.value)}
                    required
                  >
                    <option value="">Pilih persediaan Anda</option>
                    {available
                      .filter(
                        (p) =>
                          p.id === item.pickup_id ||
                          !items.some((line) => line.pickup_id === p.id),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {categoryLabel(p.category)} · {p.area} ·{" "}
                          {number(pickupBalance(state, p).kg)} kg
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
              {balance && (
                <small className="text-muted d-block my-2">
                  Tersedia {number(balance.eggs)} butir / {number(balance.kg)}{" "}
                  kg · Harga {money(linePrice(item))}/kg
                </small>
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
                {money(Math.round(Number(item.kg) * linePrice(item)))}
              </div>
            </div>
          );
        })}
        <div className="info-note">
          <Info size={16} />
          <span>
            Harga aktif ditetapkan atasan. Harga final tersimpan otomatis saat
            transaksi dibuat dan tidak berubah mengikuti harga berikutnya.
          </span>
        </div>
        {!price && (
          <div className="alert alert-warning mt-2">
            Belum ada harga aktif. Minta atasan menetapkan harga sebelum
            mencatat penjualan.
          </div>
        )}
      </div>
      <div className="row g-3">
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
        {!isFull && (
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
      <div className="invoice-summary mt-3">
        <div>
          <span>Total penjualan</span>
          <strong>{money(total)}</strong>
        </div>
        <div>
          <span>Nominal dibayar</span>
          <span>{money(payment)}</span>
        </div>
        <div>
          <span>Sisa tagihan</span>
          <strong>{money(Math.max(0, total - payment))}</strong>
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
      <Photo label="Bukti pembayaran" onChange={setPhoto} />
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
        <Field className="col-sm-6" label="Telur bentes (Rp/kg)">
          <input
            name="cracked_price"
            className="form-control"
            type="number"
            min="1"
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
    title: "Catat produksi telur",
    subtitle: "Panen hari ini, tercatat dengan rapi.",
    form: ProductionForm,
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
    subtitle: "Buat akses untuk anggota tim Anda.",
    form: UserForm,
  },
  barn: {
    title: "Tambah kandang ayam",
    subtitle: "Kelompokkan sumber produksi dan pemakaian pakan.",
    form: BarnForm,
  },
  "feed.create": {
    title: "Jenis pakan baru",
    subtitle: "Kelola katalog persediaan pakan ternak.",
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
type UnconfirmedSale = {
  user_id: string;
  request_id: string;
  action: "sale.create";
  payload: CommandPayload;
  total: number | null;
};
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
export function EntryModal({
  kind,
  onClose,
  onSaved,
}: {
  kind: string | null;
  onClose: () => void;
  onSaved?: (action: string) => void;
}) {
  const { command, user, refresh, mode, state } = useFarm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [employeeKind, setEmployeeKind] = useState<"pickup" | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSale | null>(() =>
    mode === "live" && user && kind === "sale"
      ? readUnconfirmedSale(user.id)
      : null,
  );
  const errorRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setEmployeeKind(null);
    setError("");
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
    if (user) {
      try {
        sessionStorage.removeItem(unconfirmedSaleKey(user.id));
      } catch {
        /* Browsers with unavailable storage already reject the API command's retry key. */
      }
    }
    setUnconfirmed(null);
  };
  const close = () => {
    if (busy) return;
    if (
      unconfirmed &&
      !window.confirm(
        "Penjualan belum dipastikan tersimpan. Data percobaan tetap disimpan di perangkat ini. Periksa riwayat, lalu buka Jual untuk mencoba data yang sama. Tutup sekarang?",
      )
    )
      return;
    setError("");
    onClose();
  };
  const save = async (
    requestedAction: string,
    requestedPayload: CommandPayload,
  ) => {
    if (busy) return;
    const action = unconfirmed?.action || requestedAction;
    const payload = unconfirmed?.payload || requestedPayload;
    let attempt = unconfirmed;
    let succeeded = false;
    let sending = false;
    setBusy(true);
    setError("");
    try {
      if (mode === "live" && user && action === "sale.create" && !attempt) {
        const snapshot = state.prices.find(
          (price) => price.id === payload.expected_price_id,
        );
        const lines = Array.isArray(payload.items)
          ? (payload.items as { kg: number; category: Category }[])
          : [];
        attempt = {
          user_id: user.id,
          request_id: crypto.randomUUID(),
          action: "sale.create",
          payload: JSON.parse(JSON.stringify(payload)) as CommandPayload,
          total: snapshot
            ? lines.reduce(
                (sum, item) =>
                  sum +
                  Math.round(
                    item.kg *
                      (item.category === "good"
                        ? snapshot.good_price
                        : snapshot.cracked_price),
                  ),
                0,
              )
            : null,
        };
      }
      if (attempt && user) {
        // Save the exact payload before sending so reopening or refreshing can only retry
        // the original fingerprint, even when the current price has since changed.
        sessionStorage.setItem(
          unconfirmedSaleKey(user.id),
          JSON.stringify(attempt),
        );
      }
      sending = true;
      await command(action, payload, attempt?.request_id);
      if (action === "sale.create") clearUnconfirmed();
      succeeded = true;
    } catch (e) {
      setError(
        !sending && !unconfirmed
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
      if (action === "sale.create") clearUnconfirmed();
      if (
        action === "sale.create" &&
        errorMessage(e).toLowerCase().includes("harga")
      ) {
        try {
          await refresh();
        } catch {
          /* Retain the original validation error and entered form values. */
        }
      }
    } finally {
      setBusy(false);
    }
    if (succeeded) {
      onSaved?.(action);
      onClose();
    }
  };
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
          <strong>Belum ada kepastian penjualan tersimpan</strong>
          <p className="mt-2 mb-2">
            Coba lagi dengan data yang sama. Jumlah dan harga yang sudah dikirim
            tetap dipertahankan agar tidak tercatat dua kali.
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
      </fieldset>
    </Dialog>
  );
}
export default EntryModal;
