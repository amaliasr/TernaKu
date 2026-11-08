"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Egg,
  Plus,
  Trash2,
} from "lucide-react";
import { useFarm } from "@/lib/store";
import { ALL_EGG_TYPES, NEW_EGG_TYPES, EGG_TYPES, eggTypePrice } from "@/lib/egg-types";
import {
  activePrice,
  dateLabel,
  eggStock,
  money,
  number,
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
import Photo from "./PhotoUpload";
import { useDraftField, useSaleDueDate } from "./DraftBoundary";
import { SaleQuantities } from "./SaleQuantities";
import { saleStockPreview, saleStockKey } from "@/lib/sale-availability";
import { SaleStockSourceField, useSaleStockSource, type SaleStart } from "./SaleStockSource";
import HarvestForm from "./HarvestForm";

type Props = {
  kind: "production" | "pickup" | "sale";
  onSave: (action: string, payload: CommandPayload) => Promise<void>;
  busy: boolean;
  onClose: () => void;
  saleStart?: SaleStart;
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
        <button
          className="btn btn-light"
          type="button"
          onClick={onClose}
          disabled={busy}
        >
          Batal
        </button>
        <LoadingButton
          busy={busy}
          disabled={disabled}
          className={`btn btn-primary ${styles.save}`}
        >
          {label}
        </LoadingButton>
      </div>
    </form>
  );
}

function CategoryButtons({
  value,
  onChange,
  stock,
  choices = [...NEW_EGG_TYPES],
}: {
  value?: Category;
  onChange: (value: Category) => void;
  stock?: Partial<Record<Category, Quantity>>;
  choices?: Category[];
}) {
  const visible: Category[] = [...NEW_EGG_TYPES];
  const button = (category: Category) => {
    const remaining = stock?.[category];
    const unavailable = !choices.includes(category) || (remaining && (remaining.kg <= 0 || remaining.eggs <= 0));
    return <button type="button" key={category} disabled={Boolean(unavailable)}
      className={`${styles.category} ${category === value ? styles.selected : ""}`}
      aria-pressed={category === value} onClick={() => onChange(category)}>
      <span><Egg size={23} /><strong>{EGG_TYPES[category].shortLabel}</strong>{category === value && <Check size={18} />}</span>
      <small>{unavailable ? "Stok habis" : remaining ? `${quantity(remaining.kg)} kg · ${quantity(remaining.eggs)} butir` : ""}</small>
    </button>;
  };
  return <fieldset className={styles.categories}><legend>Jenis telur</legend>
    <p className={styles.typeGroup}>Telur Bagus</p>
    <div className={styles.twoColumns}>{visible.filter(c => c === "skm" || c === "skm_new").map(button)}</div>
    <div className={styles.typeExtra}>{visible.filter(c => c === "cracked").map(button)}</div>
  </fieldset>;
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

function PickupEntry({
  onSave,
  busy,
  onClose,
}: Props) {
  const { state, user } = useFarm();
  const [category, setCategory] = useState<Category>("skm");
  const [eggs, setEggs] = useState("");
  const [kg, setKg] = useState("");
  const [trays, setTrays] = useState("");
  const [date, setDate] = useState("");
  const [initialDate] = useState(() => localNow());
  const stock = Object.fromEntries(ALL_EGG_TYPES.map(type => [type, eggStock(state, type)])) as Record<Category, Quantity>;
  const available = stock[category];
  const estimate = Number(trays) * 10;
  const weightWarning =
    estimate > 0 &&
    Number(kg) > 0 &&
    Math.abs(Number(kg) - estimate) / estimate > 0.3;
  return (
    <SimpleForm
      busy={busy}
      onClose={onClose}
      label="Simpan pengambilan"
      disabled={!available.kg || !available.eggs}
      onSubmit={(event) => {
        event.preventDefault();
        const data = dataFrom(event.currentTarget);
        void onSave("pickup.create", {
          ...data,
          date: `${date || initialDate}:00+07:00`,
          category,
          eggs: Number(eggs),
          kg: Number(kg),
          trays: Number(trays || 0),
        });
      }}
    >
      <p className={styles.caption}>
        {dateLabel(date || initialDate)} · {user?.name}.{" "}
        Telur diambil dari stok gudang.
      </p>
      <CategoryButtons
        value={category}
        onChange={setCategory}
        stock={stock}
      />
      {(!available.kg || !available.eggs) && (
        <p className={styles.warning}>
          Stok {categoryLabel(category).toLowerCase()} belum tersedia. Pilih
          jenis lain atau pastikan panen sudah diterima di gudang.
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
      <Field label="Mau dijual ke mana?">
          <input
            name="area"
            className="form-control"
            placeholder="Contoh: Pasar Pagi"
            maxLength={150}
            required
          />
      </Field>
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
          label="Waktu pengambilan (WIB)"
          hint="Kosongkan untuk memakai hari ini."
        >
          <input
            className="form-control"
            type="datetime-local"
            max={localNow()}
            value={date}
            onInput={(e) => setDate(e.currentTarget.value)}
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
  category?: Category;
  /** Only older employee drafts can contain a manual gift. */
  is_free?: boolean;
  key: number;
  pickup_id: string;
  kg: string;
  eggs: string;
  trays: string;
};

function SaleEntry({ onSave, busy, onClose, saleStart }: Props) {
  const { state, user, priceSync, refresh } = useFarm();
  const price = activePrice(state);
  const { source, setSource, available, warehouseSale, optionFor, choiceFor, emptyMessage } = useSaleStockSource(state, user?.id, saleStart);
  const [items, setItems] = useDraftField<SaleLine[]>("items", () => [
    {
      key: 0,
      ...choiceFor(source),
      kg: "",
      eggs: "",
      trays: "",
    },
  ]);
  const [method, setMethod] = useDraftField<PaymentMethod>("method", "cash");
  const [full, setFull] = useDraftField("fullyPaid", true);
  const [paid, setPaid] = useDraftField("paid", "0");
  const [dueDate, setDueDate] = useSaleDueDate();
  const [customer, setCustomer] = useDraftField("customer", "");
  const [photo, setPhoto] = useDraftField("photo", "");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [date, setDate] = useDraftField("date", "");
  const [initialDate] = useDraftField("initialDate", localNow);
  const [reviewedPriceId, setReviewedPriceId] = useDraftField("reviewedPriceId", price?.id);
  const [reviewMessage, setReviewMessage] = useState(false);
  const priceReviewRef = useRef<HTMLDivElement>(null);
  const hasQuantity = items.some((item) => item.kg !== "" || item.eggs !== "");
  const { issues: stockIssues, estimatedEggs } = saleStockPreview(items, available, source);
  const missingPrice = items.some(item => { const option = optionFor(item); return option && eggTypePrice(price, option.category) === undefined; });
  const showTotal = !!price && !missingPrice && stockIssues.size === 0 && items.every(item => optionFor(item));
  const oldGift = !!price && price.cracked_price > 0 && items.some(item => item.is_free && optionFor(item)?.category === "cracked");
  const needsPriceReview = oldGift || (!!price && hasQuantity && reviewedPriceId !== price.id);
  const unitPrice = (item: SaleLine) => {
    const pickup = optionFor(item);
    if (!pickup || !price) return 0;
    return eggTypePrice(price, pickup.category) ?? 0;
  };
  const total = items.reduce(
    (sum, item) => sum + Math.round(Number(item.kg) * unitPrice(item)),
    0,
  );
  const hasFree = price?.cracked_price === 0 && items.some(item => optionFor(item)?.category === "cracked");
  const payment = total === 0 ? 0 : full ? total : Number(paid);
  const update = (
    key: number,
    field: keyof Omit<SaleLine, "key" | "is_free">,
    value: string,
  ) => {
    if (!hasQuantity) setReviewedPriceId(price?.id);
    setItems((old) =>
      old.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    );
  };

  const sourceField = <SaleStockSourceField source={source} onChange={next => {
    if (next === source) return;
    setSource(next);
    setItems(old => old.map(item => ({ ...item, ...choiceFor(next) })));
  }} />;
  return (
    <SimpleForm
      busy={busy}
      onClose={onClose}
      label={photoBusy ? "Memproses foto…" : "Simpan penjualan"}
      disabled={!showTotal || photoBusy || !photo}
      onSubmit={(event) => {
        event.preventDefault();
        if (photoBusy || !photo || !showTotal) return;
        if (needsPriceReview) {
          setReviewMessage(true);
          priceReviewRef.current?.focus();
          return;
        }
        const data = dataFrom(event.currentTarget);
        void onSave("sale.create", {
          ...data,
          date: `${date || initialDate}:00+07:00`,
          expected_price_id: price?.id,
          stock_source: source,
          items: items.map((item) => ({
            pickup_id: warehouseSale ? "" : item.pickup_id,
            category: optionFor(item)?.category,
            ...(item.eggs.trim() ? { eggs: Number(item.eggs) } : {}),
            kg: Number(item.kg),
            trays: Number(item.trays || 0),
          })),
          payment_method: total === 0 ? "cash" : method,
          customer,
          paid: payment,
          due_date: payment < total ? dueDate : undefined,
          photo: photo || undefined,
        });
      }}
    >
      {sourceField}
      {emptyMessage && <p className={styles.warning}>{emptyMessage}</p>}
      <div className={styles.priceBar} aria-label="Harga telur saat ini">
        {(["skm", "cracked"] as const).map(type => <div key={type}><span>{type === "skm" ? "Telur bagus" : "Telur bentes"} / kg</span><strong>{eggTypePrice(price, type) === undefined ? "Belum diatur" : eggTypePrice(price, type) === 0 ? "Gratis" : money(eggTypePrice(price, type)!)}</strong>{type === "skm" && <span>SKM & SKM Baru</span>}</div>)}
      </div>
      {missingPrice && <p className={styles.warning} role="alert">Harga jenis telur yang dipilih belum ditetapkan. Minta atasan mengisi harganya sebelum menjual.</p>}
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
        const pickup = optionFor(item);
        const balance = pickup?.balance;
        const issue = stockIssues.get(saleStockKey(item, source));
        const choices = available;
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
            {warehouseSale ? (
              <CategoryButtons value={pickup?.category} onChange={category => update(item.key, "category", category)}
                choices={available.map(option => option.category)} />
            ) : available.length === 1 && pickup ? (
              <p className={styles.pickupLabel}>
                <Egg size={20} />
                <strong>{categoryLabel(pickup.category)}</strong>
                <span>{pickup.area}</span>
              </p>
            ) : (
              <Field label={warehouseSale ? "Jenis telur di gudang" : "Pilih telur yang Anda bawa"}>
                <select
                  className="form-select"
                  value={pickup?.id || ""}
                  onChange={(e) =>
                    update(item.key, warehouseSale ? "category" : "pickup_id", e.target.value)
                  }
                  required
                >
                  <option value="">{warehouseSale ? "Pilih jenis telur" : "Pilih jenis dan pengambilan"}</option>
                  {choices.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {categoryLabel(entry.category)} · {warehouseSale ? "" : `${entry.area} · ${dateLabel(entry.date)} · `}
                      {quantity(entry.balance.kg)} kg
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {issue && <p className={styles.warning} role="alert">{issue}</p>}
            {balance && (
              <p className={styles.hint}>
                {warehouseSale ? "Tersedia di gudang" : "Anda bawa"} {quantity(balance.eggs)} butir ·{" "}
                {quantity(balance.kg)} kg{warehouseSale && ` · ${quantity(balance.trays)} krat`}. Harga {pickup && eggTypePrice(price, pickup.category) !== undefined ? `${money(unitPrice(item))}/kg` : "belum diatur"}.
              </p>
            )}
            <SaleQuantities
              kg={item.kg} eggs={item.eggs} available={balance} estimatedEggs={estimatedEggs.get(index)}
              onKg={value => update(item.key, "kg", value)} onEggs={value => update(item.key, "eggs", value)}
              countSummary={Number(item.trays) > 0 ? `Jumlah butir dan krat · ${quantity(Number(item.trays))} krat` : undefined}
              extraCountField={
              <Field label="Krat yang dijual">
                <input
                  className="form-control"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  max={warehouseSale ? balance?.trays : undefined}
                  value={item.trays}
                  placeholder="0"
                  onChange={(e) => update(item.key, "trays", e.target.value)}
                />
              </Field>
              }
            />
            {items.length > 1 && <div className={styles.lineTotal}>
              <span>Subtotal</span>
              <strong>
                {!price || !pickup || issue || eggTypePrice(price, pickup.category) === undefined ? "—" : pickup.category === "cracked" && price.cracked_price === 0
                  ? "Gratis"
                  : money(Math.round(Number(item.kg) * unitPrice(item)))}
              </strong>
            </div>}
          </section>
        );
      })}
      {items.length < 100 && (
        <button
          type="button"
          className={`btn btn-outline-primary ${styles.add}`}
          onClick={() => {
            const key = Math.max(0, ...items.map(item => item.key)) + 1;
            setItems((old) => [
              ...old,
              {
                key,
                ...choiceFor(source),
                eggs: "",
                kg: "",
                trays: "",
              },
            ]);
          }}
        >
          <Plus size={20} /> Tambah jenis telur
        </button>
      )}
      <Field
          label={hasFree ? "Nama penerima telur gratis (wajib)" : "Nama pelanggan (wajib)"}
        >
          <input
            className="form-control"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
            maxLength={150}
            placeholder="Contoh: Pak Budi"
            pattern={".*\\S.*"}
            title="Isi nama pelanggan, bukan hanya spasi."
            required
          />
        </Field>
      <Photo value={photo} onChange={setPhoto} onBusyChange={setPhotoBusy} label="Foto dokumentasi penjualan" optional={false} disabled={busy} />
      {!(hasFree && total === 0) && (
        <Optional label={`Pembayaran: ${methodLabel(method)} · ${full ? "Lunas" : "Belum lunas"}`}>
          <div className={styles.payment}>
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
          </div>
        </Optional>
      )}
      {payment < total && (
        <Field label="Kapan sisa tagihan akan dibayar?">
          <input type="date" name="due_date" className="form-control" value={dueDate} onInput={e => setDueDate(e.currentTarget.value)} onChange={e => setDueDate(e.target.value)} required />
        </Field>
      )}
      <Optional label="Tambah nomor HP, waktu, atau catatan">
        <Field label="Nomor HP pelanggan (opsional)">
          <input
            name="phone" data-draft-native
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
            onInput={(e) => setDate(e.currentTarget.value)}
              onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Catatan">
          <textarea
            name="notes" data-draft-native
            className="form-control"
            rows={2}
            maxLength={2000}
          />
        </Field>
      </Optional>
      <div className={styles.summary} aria-live="polite">
        <span>Total penjualan</span>
        <strong>{showTotal ? money(total) : "—"}</strong>
        <small>
          {!showTotal ? "Periksa pilihan telur, jumlah, dan harga." : hasFree && total === 0 ? (
            "Gratis · tidak ada tagihan"
          ) : (
            <>
              {methodLabel(method)} ·{" "}
              {full
                ? "Lunas"
                : `Diterima ${money(payment)} · Sisa ${money(Math.max(0, total - payment))}`}
            </>
          )}
        </small>
      </div>
      {needsPriceReview && showTotal && (
        <div
          className={styles.warning}
          ref={priceReviewRef}
          tabIndex={-1}
          role="alert"
        >
          <strong>{oldGift ? "Draf ini sebelumnya ditandai gratis" : "Harga baru dari atasan"}</strong>
          <p>
            Total sekarang {money(total)}.{" "}
            {oldGift
              ? "Telur bentes sekarang mengikuti harga dari atasan. Periksa totalnya sebelum menyimpan."
              : reviewMessage
              ? "Periksa dan setujui harga baru sebelum menyimpan."
              : "Periksa total sebelum menyimpan."}
          </p>
          <button
            className="btn btn-warning"
            type="button"
            onClick={() => {
              if (oldGift) setItems(previous => previous.map(({ is_free, ...line }) => line));
              setReviewedPriceId(price?.id);
              setReviewMessage(false);
            }}
          >
            {oldGift ? "Pakai harga dari atasan" : "Pakai harga baru"}
          </button>
        </div>
      )}
    </SimpleForm>
  );
}

export default function EmployeeEntry(props: Props) {
  if (props.kind === "production") return <HarvestForm {...props} />;
  return props.kind === "sale" ? (
    <SaleEntry {...props} />
  ) : (
    <PickupEntry {...props} />
  );
}
