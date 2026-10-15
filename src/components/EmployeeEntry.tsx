"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Egg,
  ImagePlus,
  Plus,
  Trash2,
  Warehouse,
} from "lucide-react";
import { useFarm } from "@/lib/store";
import {
  activePrice,
  dateLabel,
  eggStock,
  money,
  number,
  pickupBalance,
  today,
} from "@/lib/domain";
import type {
  Category,
  CommandPayload,
  PaymentMethod,
  Quantity,
} from "@/lib/types";
import {
  categoryLabel,
  dataFrom,
  Field,
  LoadingButton,
  localNow,
  methodLabel,
} from "./ModuleUI";
import styles from "./EmployeeEntry.module.css";

type Props = {
  kind: "production" | "pickup" | "sale";
  onSave: (action: string, payload: CommandPayload) => Promise<void>;
  busy: boolean;
  onClose: () => void;
  onSwitchKind: (kind: "pickup") => void;
};

const quantity = (value: number) => number(value, 3);

function SimpleForm({
  children,
  onSubmit,
  busy,
  onClose,
  label,
  disabled = false,
}: {
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  onClose: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <form
      className={styles.form}
      onSubmit={onSubmit}
      onInvalidCapture={(event) => {
        let details = (event.target as HTMLElement).closest("details");
        while (details) {
          details.open = true;
          details = details.parentElement?.closest("details") || null;
        }
      }}
    >
      <fieldset disabled={busy} className={styles.body}>
        {children}
      </fieldset>
      <div className={styles.footer}>
        <LoadingButton
          busy={busy}
          disabled={disabled}
          className={`btn btn-primary ${styles.save}`}
        >
          {label}
        </LoadingButton>
        <button
          className="btn btn-light"
          type="button"
          onClick={onClose}
          disabled={busy}
        >
          Batal
        </button>
      </div>
    </form>
  );
}

function CategoryButtons({
  value,
  onChange,
  stock,
}: {
  value: Category;
  onChange: (value: Category) => void;
  stock?: Record<Category, Quantity>;
}) {
  return (
    <fieldset className={styles.categories}>
      <legend>Jenis telur</legend>
      <div className={styles.twoColumns}>
        {(["good", "cracked"] as const).map((category) => (
          <button
            type="button"
            key={category}
            className={`${styles.category} ${category === value ? styles.selected : ""}`}
            aria-pressed={category === value}
            onClick={() => onChange(category)}
          >
            <span>
              <Egg size={23} />
              <strong>{category === "good" ? "Bagus" : "Bentes"}</strong>
              {category === value && <Check size={18} />}
            </span>
            {stock && (
              <small>
                {quantity(stock[category].kg)} kg ·{" "}
                {quantity(stock[category].eggs)} butir
              </small>
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Numbers({
  eggs,
  kg,
  onEggs,
  onKg,
  available,
}: {
  eggs: string;
  kg: string;
  onEggs: (value: string) => void;
  onKg: (value: string) => void;
  available?: Quantity;
}) {
  return (
    <div className={styles.twoColumns}>
      <Field label="Jumlah butir">
        <input
          className="form-control"
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          max={available?.eggs}
          placeholder="0"
          value={eggs}
          onChange={(e) => onEggs(e.target.value)}
          required
        />
      </Field>
      <Field label="Berat (kg)">
        <input
          className="form-control"
          type="number"
          inputMode="decimal"
          min="0.001"
          step="0.001"
          max={available?.kg}
          placeholder="0,00"
          value={kg}
          onChange={(e) => onKg(e.target.value)}
          required
        />
      </Field>
    </div>
  );
}

function Photo({ onChange }: { onChange: (value: string) => void }) {
  const [error, setError] = useState("");
  return (
    <Field
      label="Foto (boleh dikosongkan)"
      hint="JPG, PNG, atau WebP. Maksimal 1 MB."
    >
      <span className={styles.photo}>
        <ImagePlus size={20} /> Tambahkan foto bila perlu
      </span>
      <input
        className="form-control"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          setError("");
          onChange("");
          if (!file) return;
          if (
            file.size > 1048576 ||
            !["image/jpeg", "image/png", "image/webp"].includes(file.type)
          ) {
            setError("Pilih foto JPG, PNG, atau WebP maksimal 1 MB.");
            event.target.value = "";
            return;
          }
          const reader = new FileReader();
          reader.onload = () => onChange(String(reader.result));
          reader.onerror = () =>
            setError("Foto belum bisa dibaca. Silakan pilih kembali.");
          reader.readAsDataURL(file);
        }}
      />
      {error && (
        <small className="text-danger" role="alert">
          {error}
        </small>
      )}
    </Field>
  );
}

function Optional({
  label = "Tambahan (boleh dikosongkan)",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <details className={styles.optional}>
      <summary>{label}</summary>
      <div className={styles.optionalBody}>{children}</div>
    </details>
  );
}

function QuantityEntry({
  kind,
  onSave,
  busy,
  onClose,
}: Props & { kind: "production" | "pickup" }) {
  const { state, user } = useFarm();
  const [category, setCategory] = useState<Category>("good");
  const [eggs, setEggs] = useState("");
  const [kg, setKg] = useState("");
  const [trays, setTrays] = useState("");
  const [photo, setPhoto] = useState("");
  const [date, setDate] = useState("");
  const isPickup = kind === "pickup";
  const [initialDate] = useState(() => (isPickup ? localNow() : today()));
  const stock = {
    good: eggStock(state, "good"),
    cracked: eggStock(state, "cracked"),
  };
  const available = isPickup ? stock[category] : undefined;
  const estimate = Number(trays) * 10;
  const weightWarning =
    estimate > 0 &&
    Number(kg) > 0 &&
    Math.abs(Number(kg) - estimate) / estimate > 0.3;
  return (
    <SimpleForm
      busy={busy}
      onClose={onClose}
      label={isPickup ? "Simpan pengambilan" : "Simpan panen"}
      disabled={isPickup && (!available?.kg || !available.eggs)}
      onSubmit={(event) => {
        event.preventDefault();
        const data = dataFrom(event.currentTarget);
        void onSave(`${kind}.create`, {
          ...data,
          date: isPickup
            ? `${date || initialDate}:00+07:00`
            : date || initialDate,
          category,
          eggs: Number(eggs),
          kg: Number(kg),
          trays: Number(trays || 0),
          ...(isPickup ? {} : { photo: photo || undefined }),
        });
      }}
    >
      <p className={styles.caption}>
        {dateLabel(date || initialDate)} · {user?.name}.{" "}
        {isPickup
          ? "Telur diambil dari stok gudang."
          : "Panen masuk ke stok gudang."}
      </p>
      <CategoryButtons
        value={category}
        onChange={setCategory}
        stock={isPickup ? stock : undefined}
      />
      {isPickup && (!available?.kg || !available.eggs) && (
        <p className={styles.warning}>
          Stok {categoryLabel(category).toLowerCase()} belum tersedia. Pilih
          jenis lain atau catat panen terlebih dahulu.
        </p>
      )}
      <Numbers
        eggs={eggs}
        kg={kg}
        onEggs={setEggs}
        onKg={setKg}
        available={available}
      />
      <p className={styles.hint}>
        Isi berat hasil timbangan, bukan perkiraan dari krat.
      </p>
      {isPickup && (
        <Field label="Mau dijual ke mana?">
          <input
            name="area"
            className="form-control"
            placeholder="Contoh: Pasar Pagi"
            maxLength={150}
            required
          />
        </Field>
      )}
      <Optional>
        <Field
          label="Jumlah krat"
          hint="Boleh kosong. Berat tetap mengikuti timbangan."
        >
          <input
            className="form-control"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            placeholder="0"
            value={trays}
            onChange={(e) => setTrays(e.target.value)}
          />
        </Field>
        {estimate > 0 && (
          <p className={styles.hint}>
            Perkiraan {quantity(estimate)} kg dari {trays} krat.
          </p>
        )}
        {weightWarning && (
          <p className={styles.warning}>
            <AlertTriangle size={18} /> Berat berbeda lebih dari 30% dari
            perkiraan krat. Periksa timbangan; data tetap bisa disimpan.
          </p>
        )}
        <Field
          label={isPickup ? "Waktu pengambilan (WIB)" : "Tanggal panen"}
          hint="Kosongkan untuk memakai hari ini."
        >
          <input
            className="form-control"
            type={isPickup ? "datetime-local" : "date"}
            max={isPickup ? localNow() : today()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        {!isPickup && (
          <Field label="Kandang asal">
            <select className="form-select" name="barn_id" defaultValue="">
              <option value="">Tidak perlu diisi</option>
              {state.barns.map((barn) => (
                <option key={barn.id} value={barn.id}>
                  {barn.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Catatan">
          <textarea
            name="notes"
            className="form-control"
            rows={2}
            maxLength={2000}
          />
        </Field>
        {!isPickup && <Photo onChange={setPhoto} />}
      </Optional>
      <div className={styles.summary}>
        <span>{categoryLabel(category)}</span>
        <strong>
          {quantity(Number(eggs))} butir · {quantity(Number(kg))} kg
        </strong>
      </div>
    </SimpleForm>
  );
}

type SaleLine = {
  key: number;
  pickup_id: string;
  kg: string;
  eggs: string;
  trays: string;
};

function SaleEntry({ onSave, busy, onClose, onSwitchKind }: Props) {
  const { state, user, priceSync, refresh } = useFarm();
  const price = activePrice(state);
  const available = state.pickups.filter(
    (pickup) =>
      pickup.user_id === user?.id &&
      pickupBalance(state, pickup).kg > 0 &&
      pickupBalance(state, pickup).eggs > 0,
  );
  const nextKey = useRef(1);
  const [items, setItems] = useState<SaleLine[]>(() => [
    {
      key: 0,
      pickup_id: available.length === 1 ? available[0].id : "",
      kg: "",
      eggs: "",
      trays: "",
    },
  ]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [full, setFull] = useState(true);
  const [paid, setPaid] = useState("0");
  const [photo, setPhoto] = useState("");
  const [date, setDate] = useState("");
  const [initialDate] = useState(localNow);
  const [reviewedPriceId, setReviewedPriceId] = useState(price?.id);
  const [reviewMessage, setReviewMessage] = useState(false);
  const priceReviewRef = useRef<HTMLDivElement>(null);
  const hasQuantity = items.some((item) => item.kg !== "" || item.eggs !== "");
  const priceChanged = !!price && hasQuantity && reviewedPriceId !== price.id;
  const unitPrice = (item: SaleLine) => {
    const pickup = available.find((entry) => entry.id === item.pickup_id);
    return pickup
      ? (pickup.category === "good"
          ? price?.good_price
          : price?.cracked_price) || 0
      : 0;
  };
  const total = items.reduce(
    (sum, item) => sum + Math.round(Number(item.kg) * unitPrice(item)),
    0,
  );
  const payment = full ? total : Number(paid);
  const update = (
    key: number,
    field: keyof Omit<SaleLine, "key">,
    value: string,
  ) => {
    if (!hasQuantity) setReviewedPriceId(price?.id);
    setItems((old) =>
      old.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    );
  };

  if (!available.length)
    return (
      <div className={`${styles.form} ${styles.empty}`}>
        <Warehouse size={36} />
        <h3>Belum ada telur yang Anda bawa</h3>
        <p>
          Catat dulu telur yang diambil dari gudang. Setelah itu, buka Jual
          untuk mencatat penjualan.
        </p>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => onSwitchKind("pickup")}
        >
          Ambil telur dari gudang
        </button>
        <button className="btn btn-light" type="button" onClick={onClose}>
          Kembali
        </button>
      </div>
    );

  return (
    <SimpleForm
      busy={busy}
      onClose={onClose}
      label="Simpan penjualan"
      disabled={!price}
      onSubmit={(event) => {
        event.preventDefault();
        if (priceChanged) {
          setReviewMessage(true);
          priceReviewRef.current?.focus();
          return;
        }
        const data = dataFrom(event.currentTarget);
        void onSave("sale.create", {
          ...data,
          date: `${date || initialDate}:00+07:00`,
          expected_price_id: price?.id,
          items: items.map((item) => ({
            pickup_id: item.pickup_id,
            category: available.find((pickup) => pickup.id === item.pickup_id)
              ?.category,
            eggs: Number(item.eggs),
            kg: Number(item.kg),
            trays: Number(item.trays || 0),
          })),
          payment_method: method,
          paid: payment,
          photo: photo || undefined,
        });
      }}
    >
      <div className={styles.priceBar} aria-label="Harga telur saat ini">
        <div>
          <span>Bagus / kg</span>
          <strong>{price ? money(price.good_price) : "Belum diatur"}</strong>
        </div>
        <div>
          <span>Bentes / kg</span>
          <strong>{price ? money(price.cracked_price) : "Belum diatur"}</strong>
        </div>
      </div>
      <p className={styles.hint}>
        Harga dari atasan. Total mengikuti berat yang dijual.
      </p>
      {priceSync.error && (
        <div className={styles.warning} role="status">
          <strong>Harga terbaru belum bisa diperiksa</strong>
          <span>
            Periksa koneksi internet. Angka yang terlihat adalah harga terakhir
            yang diterima.
          </span>
          <button
            className="btn btn-warning"
            type="button"
            disabled={priceSync.refreshing}
            onClick={() => {
              void refresh().catch(() => {
                /* The store keeps the connection error visible. */
              });
            }}
          >
            {priceSync.refreshing ? "Memeriksa harga…" : "Periksa harga lagi"}
          </button>
        </div>
      )}
      {!price && (
        <p className={styles.warning}>
          Harga belum tersedia. Minta atasan mengatur harga terlebih dahulu.
        </p>
      )}
      {items.map((item, index) => {
        const pickup = available.find((entry) => entry.id === item.pickup_id);
        const balance = pickup ? pickupBalance(state, pickup) : undefined;
        const choices = available.filter(
          (entry) =>
            entry.id === item.pickup_id ||
            !items.some((line) => line.pickup_id === entry.id),
        );
        return (
          <section
            key={item.key}
            className={styles.saleItem}
            aria-label={`Telur yang dijual ${index + 1}`}
          >
            <div className={styles.lineHeader}>
              <strong>
                {items.length > 1 ? `Telur ${index + 1}` : "Telur yang dijual"}
              </strong>
              {items.length > 1 && (
                <button
                  className="btn btn-light"
                  type="button"
                  aria-label={`Hapus telur ${index + 1}`}
                  onClick={() =>
                    setItems((old) =>
                      old.filter((line) => line.key !== item.key),
                    )
                  }
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
            {available.length === 1 && pickup ? (
              <p className={styles.pickupLabel}>
                <Egg size={20} />
                <strong>{categoryLabel(pickup.category)}</strong>
                <span>{pickup.area}</span>
              </p>
            ) : (
              <Field label="Pilih telur yang Anda bawa">
                <select
                  className="form-select"
                  value={item.pickup_id}
                  onChange={(e) =>
                    update(item.key, "pickup_id", e.target.value)
                  }
                  required
                >
                  <option value="">Pilih jenis dan pengambilan</option>
                  {choices.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {categoryLabel(entry.category)} · {entry.area} ·{" "}
                      {dateLabel(entry.date)} ·{" "}
                      {quantity(pickupBalance(state, entry).kg)} kg
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {balance && (
              <p className={styles.hint}>
                Anda bawa {quantity(balance.eggs)} butir ·{" "}
                {quantity(balance.kg)} kg. Harga {money(unitPrice(item))}/kg.
              </p>
            )}
            <Numbers
              eggs={item.eggs}
              kg={item.kg}
              onEggs={(value) => update(item.key, "eggs", value)}
              onKg={(value) => update(item.key, "kg", value)}
              available={balance}
            />
            <Optional label="Isi jumlah krat (boleh kosong)">
              <Field label="Krat yang dijual">
                <input
                  className="form-control"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  max={balance?.trays}
                  value={item.trays}
                  placeholder="0"
                  onChange={(e) => update(item.key, "trays", e.target.value)}
                />
              </Field>
            </Optional>
            <div className={styles.lineTotal}>
              <span>Jumlah</span>
              <strong>
                {money(Math.round(Number(item.kg) * unitPrice(item)))}
              </strong>
            </div>
          </section>
        );
      })}
      {items.length < available.length && (
        <button
          type="button"
          className={`btn btn-outline-primary ${styles.add}`}
          onClick={() => {
            const remaining = available.filter(
              (pickup) => !items.some((item) => item.pickup_id === pickup.id),
            );
            const key = nextKey.current++;
            setItems((old) => [
              ...old,
              {
                key,
                pickup_id: remaining.length === 1 ? remaining[0].id : "",
                eggs: "",
                kg: "",
                trays: "",
              },
            ]);
          }}
        >
          <Plus size={20} /> Tambah jenis / pengambilan
        </button>
      )}
      <Optional
        label={`Pembayaran: ${methodLabel(method)} · ${full ? "Lunas" : "Belum lunas"}`}
      >
        <Field label="Dibayar lewat apa?">
          <select
            className="form-select"
            value={method}
            onChange={(e) => {
              const value = e.target.value as PaymentMethod;
              setMethod(value);
              if (value === "credit") {
                setFull(false);
                setPaid("0");
              }
            }}
          >
            <option value="cash">Tunai</option>
            <option value="transfer">Transfer</option>
            <option value="qris">QRIS</option>
            <option value="credit">Piutang (bayar nanti)</option>
          </select>
        </Field>
        <Field label="Sudah dibayar semuanya?">
          <select
            className="form-select"
            value={full ? "yes" : "no"}
            onChange={(e) => setFull(e.target.value === "yes")}
          >
            <option value="yes">Ya, sudah lunas</option>
            <option value="no">Belum / baru sebagian</option>
          </select>
        </Field>
        {!full && (
          <Field
            label="Uang yang sudah diterima (Rp)"
            hint="Isi 0 jika belum dibayar."
          >
            <input
              className="form-control"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              max={total}
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              required
            />
          </Field>
        )}
      </Optional>
      <Optional label="Pelanggan, foto, dan catatan (boleh kosong)">
        <Field label="Nama pelanggan">
          <input
            name="customer"
            className="form-control"
            maxLength={150}
            autoComplete="off"
          />
        </Field>
        <Field label="Nomor HP pelanggan">
          <input
            name="phone"
            className="form-control"
            type="tel"
            maxLength={30}
            autoComplete="off"
          />
        </Field>
        <Field
          label="Waktu penjualan (WIB)"
          hint="Kosongkan untuk memakai waktu sekarang."
        >
          <input
            type="datetime-local"
            className="form-control"
            max={localNow()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Catatan">
          <textarea
            name="notes"
            className="form-control"
            rows={2}
            maxLength={2000}
          />
        </Field>
        <Photo onChange={setPhoto} />
      </Optional>
      <div className={styles.summary} aria-live="polite">
        <span>Total penjualan</span>
        <strong>{money(total)}</strong>
        <small>
          {methodLabel(method)} ·{" "}
          {full
            ? "Lunas"
            : `Diterima ${money(payment)} · Sisa ${money(Math.max(0, total - payment))}`}
        </small>
      </div>
      {priceChanged && (
        <div
          className={styles.warning}
          ref={priceReviewRef}
          tabIndex={-1}
          role="alert"
        >
          <strong>Harga baru dari atasan</strong>
          <p>
            Total sekarang {money(total)}.{" "}
            {reviewMessage
              ? "Periksa dan setujui harga baru sebelum menyimpan."
              : "Periksa total sebelum menyimpan."}
          </p>
          <button
            className="btn btn-warning"
            type="button"
            onClick={() => {
              setReviewedPriceId(price?.id);
              setReviewMessage(false);
            }}
          >
            Pakai harga baru
          </button>
        </div>
      )}
    </SimpleForm>
  );
}

export default function EmployeeEntry(props: Props) {
  return props.kind === "sale" ? (
    <SaleEntry {...props} />
  ) : (
    <QuantityEntry {...props} kind={props.kind} />
  );
}
