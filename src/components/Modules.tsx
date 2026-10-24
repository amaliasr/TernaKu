"use client";

import { useState, type ReactNode } from "react";
import {
  Plus,
  Egg,
  ShoppingBag,
  Package,
  Wheat,
  TrendingUp,
  Users,
  Pencil,
  LockKeyhole,
  LockKeyholeOpen,
  Undo2,
  ArrowDownToLine,
  ReceiptText,
  Check,
  X,
  CircleDollarSign,
  ShieldCheck,
  Search,
  ChevronRight,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
} from "lucide-react";
import { useFarm } from "@/lib/store";
import {
  activePrice,
  dateLabel,
  eggStock,
  feedStock,
  isFreeSaleItem,
  money,
  number as formatNumber,
  pickupBalance,
  today,
} from "@/lib/domain";
import { printPurchase } from "@/lib/export";
import type {
  Category,
  FeedPurchase,
  Pickup,
  RecordEntity,
  Sale,
  User,
} from "@/lib/types";
import EntryModal from "./EntryModal";
import ImagePreview from "./ImagePreview";
import {
  businessDate,
  categoryLabel,
  Dialog,
  Empty,
  errorMessage,
  Filters,
  inRange,
  Pill,
  RecordDate,
} from "./ModuleUI";
import {
  CorrectionDialog,
  EmployeeDialog,
  PaymentDialog,
  ReturnDialog,
  SaleDetail,
  type SelectedRecord,
} from "./RecordDialogs";

const number = (value: number) => formatNumber(value, 3);

type OpenForm = (kind: string) => void;
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="section-label">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
function AddButton({
  children,
  onClick,
  secondary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  secondary?: boolean;
}) {
  return (
    <button
      className={`btn ${secondary ? "btn-outline-primary" : "btn-primary"}`}
      onClick={onClick}
    >
      <Plus size={17} />
      {children}
    </button>
  );
}
function Stats({
  items,
}: {
  items: {
    label: string;
    value: string;
    note?: string;
    icon: ReactNode;
    tone?: string;
  }[];
}) {
  return (
    <div className="module-stats">
      {items.map((item) => (
        <div className="module-stat" key={item.label}>
          <div className={`icon-box ${item.tone || "green"}`}>{item.icon}</div>
          <div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.note && <small>{item.note}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}
function TableEnd({
  count,
  label = "data",
}: {
  count: number;
  label?: string;
}) {
  return (
    <div className="table-end">
      <span>
        Menampilkan <strong>{number(count)}</strong> {label}
      </span>
      <small>Data yang ditampilkan sudah tersimpan</small>
    </div>
  );
}
function useFilters() {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return {
    search,
    from,
    to,
    onSearch: setSearch,
    onFrom: setFrom,
    onTo: setTo,
  };
}
function useAction() {
  const { command } = useFarm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = async (
    action: string,
    payload: Record<string, unknown>,
    message = "Perubahan berhasil disimpan.",
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await command(action, payload);
      setNotice(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    run,
    feedback: error ? (
      <div className="alert alert-danger" role="alert">
        {error}
      </div>
    ) : notice ? (
      <div
        className="alert alert-success d-flex align-items-center gap-2"
        role="status"
      >
        <CheckCircle2 size={17} />
        {notice}
      </div>
    ) : null,
  };
}
function CategorySelect({
  category,
  setCategory,
}: {
  category: string;
  setCategory: (value: string) => void;
}) {
  return (
    <select
      className="form-select filter-select"
      aria-label="Filter kategori telur"
      value={category}
      onChange={(e) => setCategory(e.target.value)}
    >
      <option value="">Semua kategori</option>
      <option value="good">Telur bagus</option>
      <option value="cracked">Telur bentes</option>
    </select>
  );
}
function CategoryPill({ category }: { category: Category }) {
  return (
    <Pill tone={category === "good" ? "success" : "warning"}>
      {categoryLabel(category)}
    </Pill>
  );
}
function Person({ name, small }: { name: string; small?: string }) {
  return (
    <div className="table-person">
      <span className="mini-avatar">
        {name
          .split(" ")
          .slice(0, 2)
          .map((n) => n[0])
          .join("")}
      </span>
      <div>
        <strong>{name}</strong>
        {small && <small>{small}</small>}
      </div>
    </div>
  );
}
function RecordButtons({
  entity,
  record,
  onEdit,
  run,
  busy,
}: {
  entity: RecordEntity;
  record: { id: string; locked: boolean; user_id: string };
  onEdit: () => void;
  run: (
    action: string,
    payload: Record<string, unknown>,
    message?: string,
  ) => Promise<void>;
  busy: boolean;
}) {
  const { user } = useFarm();
  return (
    <div className="table-actions">
      <button
        className="icon-btn"
        title={
          user?.role === "admin" || (entity === "production" && !record.locked)
            ? "Koreksi data"
            : "Ajukan koreksi"
        }
        aria-label="Koreksi data"
        onClick={onEdit}
      >
        <Pencil size={15} />
      </button>
      {user?.role === "admin" && (
        <button
          className="icon-btn"
          disabled={busy}
          title={record.locked ? "Buka kunci data" : "Kunci data"}
          aria-label={record.locked ? "Buka kunci data" : "Kunci data"}
          onClick={() =>
            void run(
              "record.lock",
              { entity, id: record.id, locked: !record.locked },
              record.locked ? "Kunci data dibuka." : "Data berhasil dikunci.",
            )
          }
        >
          {record.locked ? (
            <LockKeyhole size={15} />
          ) : (
            <LockKeyholeOpen size={15} />
          )}
        </button>
      )}
    </div>
  );
}
function ProductionPage({ open }: { open: OpenForm }) {
  const { state, user } = useFarm();
  const filters = useFilters();
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<SelectedRecord | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const action = useAction();
  const userName = (id: string) =>
    state.users.find((u) => u.id === id)?.name || "Karyawan";
  const rows = state.productions
    .filter(
      (p) =>
        (user?.role === "admin" || p.user_id === user?.id) &&
        (!category || p.category === category) &&
        inRange(p.date, filters.from, filters.to) &&
        `${userName(p.user_id)} ${state.barns.find((b) => b.id === p.barn_id)?.name} ${p.notes}`
          .toLowerCase()
          .includes(filters.search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.created_at.localeCompare(a.created_at),
    );
  const good = rows.filter((p) => p.category === "good");
  const cracked = rows.filter((p) => p.category === "cracked");
  const opened = state.productions.find((p) => p.id === detail);
  return (
    <>
      <Heading
        eyebrow="OPERASIONAL HARIAN"
        title="Produksi telur"
        description="Setiap hasil panen, tercatat dan terpantau."
      >
        {user?.role === "admin" && (
          <AddButton secondary onClick={() => open("barn")}>
            Kandang ayam
          </AddButton>
        )}
        <AddButton onClick={() => open("production")}>Catat produksi</AddButton>
      </Heading>
      {action.feedback}
      <Stats
        items={[
          {
            label: "Total produksi",
            value: `${number(rows.reduce((s, p) => s + p.kg, 0))} kg`,
            note: `${number(rows.reduce((s, p) => s + p.eggs, 0))} butir · sesuai pilihan`,
            icon: <Egg size={22} />,
          },
          {
            label: "Telur bagus",
            value: `${number(good.reduce((s, p) => s + p.kg, 0))} kg`,
            note: `${number(good.reduce((s, p) => s + p.eggs, 0))} butir`,
            icon: <ShieldCheck size={22} />,
            tone: "blue",
          },
          {
            label: "Telur bentes",
            value: `${number(cracked.reduce((s, p) => s + p.kg, 0))} kg`,
            note: `${number(cracked.reduce((s, p) => s + p.eggs, 0))} butir`,
            icon: <Egg size={22} />,
            tone: "orange",
          },
        ]}
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Riwayat produksi</h2>
            <p>
              {user?.role === "admin"
                ? "Seluruh pencatatan panen dari tim Anda."
                : "Pencatatan panen milik Anda."}
            </p>
          </div>
          <Pill>{rows.length} catatan</Pill>
        </div>
        <Filters {...filters} placeholder="Cari karyawan, kandang, catatan…">
          <CategorySelect category={category} setCategory={setCategory} />
        </Filters>
        {rows.length ? (
          <div className="table-responsive">
            <table className="table farm-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Pencatat</th>
                  <th>Kandang</th>
                  <th>Kategori</th>
                  <th className="text-end">Butir</th>
                  <th className="text-end">Berat</th>
                  <th className="text-end">Krat</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="text-link"
                        onClick={() => setDetail(p.id)}
                      >
                        <RecordDate date={p.date} />
                      </button>
                      {p.locked && (
                        <LockKeyhole
                          size={11}
                          className="ms-1 text-muted"
                          aria-label="Dikunci"
                        />
                      )}
                    </td>
                    <td>
                      <Person name={userName(p.user_id)} />
                    </td>
                    <td>
                      {state.barns.find((b) => b.id === p.barn_id)?.name || "—"}
                    </td>
                    <td>
                      <CategoryPill category={p.category} />
                    </td>
                    <td className="text-end">{number(p.eggs)}</td>
                    <td className="text-end fw-semibold">{number(p.kg)} kg</td>
                    <td className="text-end">{number(p.trays)}</td>
                    <td>
                      <RecordButtons
                        entity="production"
                        record={p}
                        onEdit={() =>
                          setSelected({ entity: "production", record: p })
                        }
                        run={action.run}
                        busy={action.busy}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Belum ada produksi yang sesuai"
            description="Catat hasil panen atau ubah pencarian dan rentang tanggal."
          />
        )}
        <TableEnd count={rows.length} label="catatan produksi" />
      </section>
      {selected && (
        <CorrectionDialog
          selected={selected}
          onClose={() => setSelected(null)}
        />
      )}
      {opened && (
        <Dialog
          title="Detail produksi"
          subtitle={dateLabel(opened.date)}
          onClose={() => setDetail(null)}
        >
          <div className="modal-body-custom">
            <div className="detail-grid">
              <div>
                <small>Pencatat</small>
                <strong>{userName(opened.user_id)}</strong>
              </div>
              <div>
                <small>Kategori</small>
                <strong>{categoryLabel(opened.category)}</strong>
              </div>
              <div>
                <small>Jumlah</small>
                <strong>{number(opened.eggs)} butir</strong>
              </div>
              <div>
                <small>Berat / krat</small>
                <strong>
                  {number(opened.kg)} kg / {number(opened.trays)} krat
                </strong>
              </div>
              <div>
                <small>Waktu input</small>
                <strong>{dateLabel(opened.created_at, true)}</strong>
              </div>
              <div>
                <small>Lokasi</small>
                <strong>{opened.location || "Tidak disertakan"}</strong>
              </div>
            </div>
            {opened.notes && <p className="text-muted mt-3">{opened.notes}</p>}
            {opened.photo && (
              <ImagePreview
                className="mt-3"
                src={opened.photo}
                alt="Dokumentasi panen"
              />
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
function SalesPage({ open }: { open: OpenForm }) {
  const { state, user } = useFarm();
  const filters = useFilters();
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<SelectedRecord | null>(null);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [payment, setPayment] = useState<Sale | null>(null);
  const action = useAction();
  const userName = (id: string) =>
    state.users.find((u) => u.id === id)?.name || "Karyawan";
  const rows = state.sales
    .filter(
      (s) =>
        (user?.role === "admin" || s.user_id === user?.id) &&
        (!status || s.payment_status === status) &&
        inRange(s.date, filters.from, filters.to) &&
        `${s.number} ${s.customer} ${s.phone} ${userName(s.user_id)}`
          .toLowerCase()
          .includes(filters.search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Heading
        eyebrow="TRANSAKSI & PELANGGAN"
        title="Penjualan telur"
        description="Kelola transaksi, pembayaran, dan nota dalam satu tempat."
      >
        <AddButton onClick={() => open("sale")}>Catat penjualan</AddButton>
      </Heading>
      {action.feedback}
      <Stats
        items={[
          {
            label: "Omzet penjualan",
            value: money(rows.reduce((s, x) => s + x.total, 0)),
            note: `${rows.length} transaksi · sesuai pilihan`,
            icon: <ShoppingBag size={22} />,
          },
          {
            label: "Pembayaran diterima",
            value: money(rows.reduce((s, x) => s + x.paid, 0)),
            note: "Total yang sudah dibayarkan",
            icon: <CircleDollarSign size={22} />,
            tone: "blue",
          },
          {
            label: "Piutang pelanggan",
            value: money(rows.reduce((s, x) => s + x.balance, 0)),
            note: `${rows.filter((x) => x.balance > 0).length} transaksi belum lunas`,
            icon: <ReceiptText size={22} />,
            tone: "orange",
          },
        ]}
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Daftar transaksi</h2>
            <p>Harga per kilogram tersimpan pada setiap transaksi.</p>
          </div>
        </div>
        <Filters {...filters} placeholder="Cari nomor, pelanggan, karyawan…">
          <select
            aria-label="Filter pembayaran"
            className="form-select filter-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Semua pembayaran</option>
            <option value="paid">Lunas</option>
            <option value="partial">Sebagian</option>
            <option value="unpaid">Belum lunas</option>
          </select>
        </Filters>
        {rows.length ? (
          <div className="table-responsive">
            <table className="table farm-table">
              <thead>
                <tr>
                  <th>Transaksi</th>
                  <th>Pelanggan</th>
                  <th>Karyawan</th>
                  <th className="text-end">Berat</th>
                  <th className="text-end">Total</th>
                  <th>Pembayaran</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        className="text-link fw-semibold"
                        onClick={() => setDetail(s)}
                      >
                        {s.number}
                      </button>
                      <small className="cell-sub">{dateLabel(s.date)}</small>
                    </td>
                    <td>
                      {s.customer || "Pelanggan umum"}
                      {s.phone && <small className="cell-sub">{s.phone}</small>}
                    </td>
                    <td>
                      <Person name={userName(s.user_id)} />
                    </td>
                    <td className="text-end">
                      {number(s.items.reduce((sum, item) => sum + item.kg, 0))}{" "}
                      kg
                    </td>
                    <td className="text-end fw-semibold text-nowrap">
                      {s.total === 0 ? "Gratis" : money(s.total)}
                      {s.total > 0 && s.items.some(isFreeSaleItem) && (
                        <small className="cell-sub">
                          Termasuk telur bentes gratis
                        </small>
                      )}
                      {s.balance > 0 && (
                        <small className="cell-sub text-warning-emphasis">
                          Sisa {money(s.balance)}
                        </small>
                      )}
                    </td>
                    <td>
                      <Pill
                        tone={
                          s.balance === 0
                            ? "success"
                            : s.paid > 0
                              ? "blue"
                              : "warning"
                        }
                      >
                        {s.total === 0
                          ? "Gratis"
                          : s.balance === 0
                            ? "Lunas"
                            : s.paid > 0
                              ? "Sebagian"
                              : "Belum lunas"}
                      </Pill>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-btn"
                          title="Lihat dan unduh nota"
                          aria-label={`Lihat nota ${s.number}`}
                          onClick={() => setDetail(s)}
                        >
                          <ReceiptText size={16} />
                        </button>
                        {s.balance > 0 && (
                          <button
                            className="icon-btn"
                            title="Terima pembayaran"
                            aria-label={`Terima pembayaran ${s.number}`}
                            onClick={() => setPayment(s)}
                          >
                            <CircleDollarSign size={16} />
                          </button>
                        )}
                        <RecordButtons
                          entity="sale"
                          record={s}
                          onEdit={() =>
                            setSelected({ entity: "sale", record: s })
                          }
                          run={action.run}
                          busy={action.busy}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Belum ada transaksi yang sesuai"
            description="Catat penjualan pertama atau ubah pilihan pencarian."
          />
        )}
        <TableEnd count={rows.length} label="transaksi" />
      </section>
      {selected && (
        <CorrectionDialog
          selected={selected}
          onClose={() => setSelected(null)}
        />
      )}
      {detail && (
        <SaleDetail
          sale={state.sales.find((s) => s.id === detail.id) || detail}
          onClose={() => setDetail(null)}
        />
      )}
      {payment && (
        <PaymentDialog
          sale={state.sales.find((s) => s.id === payment.id) || payment}
          onClose={() => setPayment(null)}
        />
      )}
    </>
  );
}
function StockPage({ open }: { open: OpenForm }) {
  const { state, user } = useFarm();
  const [tab, setTab] = useState("pickup");
  const filters = useFilters();
  const [category, setCategory] = useState("");
  const [returned, setReturned] = useState<Pickup | null>(null);
  const [selected, setSelected] = useState<SelectedRecord | null>(null);
  const action = useAction();
  const good = eggStock(state, "good"),
    cracked = eggStock(state, "cracked");
  const carried = state.pickups.reduce(
    (sum, p) => sum + pickupBalance(state, p).kg,
    0,
  );
  const userName = (id: string) =>
    state.users.find((u) => u.id === id)?.name || "Karyawan";
  const rows = state.pickups
    .filter(
      (p) =>
        (user?.role === "admin" || p.user_id === user?.id) &&
        (!category || p.category === category) &&
        inRange(p.date, filters.from, filters.to) &&
        `${p.area} ${p.notes} ${userName(p.user_id)}`
          .toLowerCase()
          .includes(filters.search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const movementLabels = {
    production: "Produksi masuk",
    pickup: "Pengambilan keluar",
    return: "Pengembalian telur",
    correction: "Koreksi produksi",
  };
  const movements = (
    state.stock_movements
      ? state.stock_movements.map((m) => ({
          key: m.id,
          date: m.date,
          category: m.category,
          label: movementLabels[m.kind],
          user: m.user_id,
          kg: m.kg,
          eggs: m.eggs,
          incoming: m.kg >= 0,
        }))
      : [
          ...state.productions.map((p) => ({
            key: `p-${p.id}`,
            date: p.date,
            category: p.category,
            label: "Produksi masuk",
            user: p.user_id,
            kg: p.kg,
            eggs: p.eggs,
            incoming: true,
          })),
          ...state.pickups.map((p) => ({
            key: `t-${p.id}`,
            date: p.date,
            category: p.category,
            label: "Pengambilan keluar",
            user: p.user_id,
            kg: -p.kg,
            eggs: -p.eggs,
            incoming: false,
          })),
          ...state.pickups
            .filter((p) => p.returned_kg > 0)
            .map((p) => ({
              key: `r-${p.id}`,
              date: "",
              category: p.category,
              label: "Retur tercatat (akumulasi)",
              user: p.user_id,
              kg: p.returned_kg,
              eggs: p.returned_eggs,
              incoming: true,
            })),
        ]
  )
    .filter(
      (m) =>
        (!category || m.category === category) &&
        (m.date
          ? inRange(m.date, filters.from, filters.to)
          : !filters.from && !filters.to) &&
        `${m.label} ${userName(m.user)}`
          .toLowerCase()
          .includes(filters.search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Heading
        eyebrow="PERSEDIAAN TELUR"
        title="Stok & pengambilan"
        description="Pantau telur di gudang dan yang sedang dibawa tim."
      >
        <AddButton onClick={() => open("pickup")}>Ambil telur</AddButton>
      </Heading>
      {action.feedback}
      <Stats
        items={[
          {
            label: "Stok telur bagus",
            value: `${number(good.kg)} kg`,
            note: `${number(good.eggs)} butir di gudang`,
            icon: <Egg size={22} />,
          },
          {
            label: "Stok telur bentes",
            value: `${number(cracked.kg)} kg`,
            note: `${number(cracked.eggs)} butir di gudang`,
            icon: <Egg size={22} />,
            tone: "orange",
          },
          {
            label: "Sedang dibawa",
            value: `${number(carried)} kg`,
            note:
              user?.role === "admin"
                ? "Persediaan seluruh tim"
                : "Persediaan Anda",
            icon: <Package size={22} />,
            tone: "blue",
          },
        ]}
      />
      <section className="panel">
        <div className="panel-header">
          <div className="module-tabs">
            <button
              className={tab === "pickup" ? "active" : ""}
              onClick={() => setTab("pickup")}
            >
              Pengambilan telur
            </button>
            <button
              className={tab === "movements" ? "active" : ""}
              onClick={() => setTab("movements")}
            >
              Pergerakan stok
            </button>
          </div>
        </div>
        <Filters {...filters} placeholder="Cari karyawan atau tujuan…">
          <CategorySelect category={category} setCategory={setCategory} />
        </Filters>
        {tab === "pickup" ? (
          rows.length ? (
            <div className="table-responsive">
              <table className="table farm-table">
                <thead>
                  <tr>
                    <th>Tanggal / karyawan</th>
                    <th>Kategori / tujuan</th>
                    <th className="text-end">Diambil</th>
                    <th className="text-end">Dikembalikan</th>
                    <th className="text-end">Sisa dibawa</th>
                    <th>Status</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const balance = pickupBalance(state, p);
                    return (
                      <tr key={p.id}>
                        <td>
                          <strong>{userName(p.user_id)}</strong>
                          <small className="cell-sub">
                            {dateLabel(p.date)}
                          </small>
                        </td>
                        <td>
                          <CategoryPill category={p.category} />
                          <small className="cell-sub">{p.area}</small>
                        </td>
                        <td className="text-end">
                          {number(p.kg)} kg
                          <small className="cell-sub">
                            {number(p.eggs)} butir
                          </small>
                        </td>
                        <td className="text-end">
                          {number(p.returned_kg)} kg
                          <small className="cell-sub">
                            {number(p.returned_eggs)} butir
                          </small>
                        </td>
                        <td className="text-end fw-semibold">
                          {number(balance.kg)} kg
                          <small className="cell-sub">
                            {number(balance.eggs)} butir
                          </small>
                        </td>
                        <td>
                          <Pill
                            tone={
                              balance.status === "Terjual"
                                ? "success"
                                : balance.status === "Dikembalikan"
                                  ? "neutral"
                                  : "blue"
                            }
                          >
                            {balance.status}
                          </Pill>
                        </td>
                        <td>
                          <div className="table-actions">
                            {balance.kg > 0 && balance.eggs > 0 && (
                              <button
                                className="icon-btn"
                                title="Kembalikan telur"
                                aria-label={`Kembalikan telur ${p.area}`}
                                onClick={() => setReturned(p)}
                              >
                                <Undo2 size={16} />
                              </button>
                            )}
                            <RecordButtons
                              entity="pickup"
                              record={p}
                              onEdit={() =>
                                setSelected({ entity: "pickup", record: p })
                              }
                              run={action.run}
                              busy={action.busy}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Belum ada pengambilan yang sesuai"
              description="Catat pengambilan untuk membawa telur dari gudang."
            />
          )
        ) : movements.length ? (
          <>
            <div className="table-responsive">
              <table className="table farm-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Pergerakan</th>
                    <th>Karyawan</th>
                    <th>Kategori</th>
                    <th className="text-end">Butir</th>
                    <th className="text-end">Berat</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.key}>
                      <td>{m.date ? dateLabel(m.date) : "—"}</td>
                      <td>
                        <span
                          className={`movement-label ${m.incoming ? "incoming" : "outgoing"}`}
                        >
                          {m.incoming ? (
                            <ArrowDownLeft size={16} />
                          ) : (
                            <ArrowUpRight size={16} />
                          )}
                          {m.label}
                        </span>
                      </td>
                      <td>{userName(m.user)}</td>
                      <td>
                        <CategoryPill category={m.category} />
                      </td>
                      <td className="text-end">
                        {m.eggs >= 0 ? "+" : ""}
                        {number(m.eggs)}
                      </td>
                      <td className="text-end fw-semibold">
                        {m.kg >= 0 ? "+" : ""}
                        {number(m.kg)} kg
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small text-muted px-4">
              {state.stock_movements
                ? user?.role === "admin"
                  ? "Riwayat panen, pengambilan, pengembalian, dan koreksi stok."
                  : "Riwayat pergerakan stok dari pencatatan Anda."
                : "Pengembalian dijumlahkan untuk setiap pengambilan. Data ini tidak ditampilkan saat Anda memilih rentang tanggal."}
            </p>
          </>
        ) : (
          <Empty title="Belum ada pergerakan yang sesuai" />
        )}
        <TableEnd
          count={tab === "pickup" ? rows.length : movements.length}
          label="catatan"
        />
      </section>
      {returned && (
        <ReturnDialog
          pickup={state.pickups.find((p) => p.id === returned.id) || returned}
          onClose={() => setReturned(null)}
        />
      )}
      {selected && (
        <CorrectionDialog
          selected={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
function FeedPage({ open }: { open: OpenForm }) {
  const { state, user } = useFarm();
  const [tab, setTab] = useState("stock");
  const filters = useFilters();
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const purchases = state.feed_purchases
    .filter(
      (p) =>
        inRange(p.date, filters.from, filters.to) &&
        `${p.number} ${p.supplier} ${p.items.map((i) => state.feeds.find((f) => f.id === i.feed_id)?.name).join(" ")}`
          .toLowerCase()
          .includes(filters.search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const usages = state.feed_usages
    .filter(
      (p) =>
        inRange(p.date, filters.from, filters.to) &&
        `${state.feeds.find((f) => f.id === p.feed_id)?.name} ${state.barns.find((b) => b.id === p.barn_id)?.name} ${p.notes}`
          .toLowerCase()
          .includes(filters.search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const feeds = state.feeds.filter((f) =>
    f.name.toLowerCase().includes(filters.search.toLowerCase()),
  );
  const low = state.feeds.filter((f) => feedStock(state, f.id) < f.min_stock);
  const download = async (purchase: FeedPurchase) => {
    setDownloading(purchase.id);
    setError("");
    try {
      await printPurchase(purchase, state);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading("");
    }
  };
  return (
    <>
      <Heading
        eyebrow="NUTRISI & PERSEDIAAN"
        title="Pakan ternak"
        description="Belanja, stok, dan pemakaian pakan yang lebih teratur."
      >
        <AddButton secondary onClick={() => open("feed.use")}>
          Pemakaian
        </AddButton>
        {user?.role === "admin" && (
          <AddButton onClick={() => open("feed.purchase")}>
            Pembelian pakan
          </AddButton>
        )}
      </Heading>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      <Stats
        items={[
          {
            label: "Total stok pakan",
            value: `${number(state.feeds.reduce((s, f) => s + feedStock(state, f.id), 0))} kg`,
            note: `${state.feeds.length} jenis pakan`,
            icon: <Wheat size={22} />,
          },
          {
            label: "Stok perlu diperhatikan",
            value: `${low.length} jenis`,
            note: "Di bawah batas stok minimum",
            icon: <Package size={22} />,
            tone: "orange",
          },
          {
            label: "Pemakaian hari ini",
            value: `${number(state.feed_usages.filter((u) => businessDate(u.date) === today()).reduce((s, u) => s + u.quantity, 0))} kg`,
            note:
              user?.role === "admin"
                ? "Tercatat untuk seluruh kandang"
                : "Pemakaian yang Anda catat",
            icon: <TrendingUp size={22} />,
            tone: "blue",
          },
        ]}
      />
      <section className="panel">
        <div className="panel-header">
          <div className="module-tabs">
            <button
              className={tab === "stock" ? "active" : ""}
              onClick={() => setTab("stock")}
            >
              Stok pakan
            </button>
            {user?.role === "admin" && (
              <button
                className={tab === "purchase" ? "active" : ""}
                onClick={() => setTab("purchase")}
              >
                Pembelian
              </button>
            )}
            <button
              className={tab === "usage" ? "active" : ""}
              onClick={() => setTab("usage")}
            >
              Pemakaian
            </button>
          </div>
          {user?.role === "admin" && (
            <button
              className="btn btn-sm btn-outline-primary"
              onClick={() => open("feed.create")}
            >
              <Plus size={15} />
              Jenis pakan
            </button>
          )}
        </div>
        {tab === "stock" ? (
          <div className="module-toolbar">
            <div className="search-input">
              <Search size={17} />
              <input
                className="form-control"
                aria-label="Cari jenis pakan"
                placeholder="Cari jenis pakan…"
                value={filters.search}
                onChange={(e) => filters.onSearch(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <Filters
            {...filters}
            placeholder={
              tab === "purchase"
                ? "Cari nota, pemasok, pakan…"
                : "Cari jenis pakan, kandang…"
            }
          />
        )}
        {tab === "stock" ? (
          feeds.length ? (
            <div className="table-responsive">
              <table className="table farm-table">
                <thead>
                  <tr>
                    <th>Jenis pakan</th>
                    {user?.role === "admin" && (
                      <th className="text-end">Pembelian</th>
                    )}
                    <th className="text-end">
                      {user?.role === "admin" ? "Pemakaian" : "Pemakaian Anda"}
                    </th>
                    <th className="text-end">Stok tersedia</th>
                    <th className="text-end">Stok minimum</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {feeds.map((f) => {
                    const stock = feedStock(state, f.id);
                    return (
                      <tr key={f.id}>
                        <td>
                          <div className="d-flex align-items-center gap-3">
                            <span className="feed-icon">
                              <Wheat size={18} />
                            </span>
                            <strong>{f.name}</strong>
                          </div>
                        </td>
                        {user?.role === "admin" && (
                          <td className="text-end">
                            {number(
                              state.feed_purchases.reduce(
                                (sum, p) =>
                                  sum +
                                  p.items
                                    .filter((i) => i.feed_id === f.id)
                                    .reduce((s, i) => s + i.quantity, 0),
                                0,
                              ),
                            )}{" "}
                            kg
                          </td>
                        )}
                        <td className="text-end">
                          {number(
                            state.feed_usages
                              .filter((u) => u.feed_id === f.id)
                              .reduce((s, u) => s + u.quantity, 0),
                          )}{" "}
                          kg
                        </td>
                        <td className="text-end fw-semibold">
                          {number(stock)} kg
                        </td>
                        <td className="text-end">{number(f.min_stock)} kg</td>
                        <td>
                          <Pill
                            tone={stock < f.min_stock ? "warning" : "success"}
                          >
                            {stock < f.min_stock ? "Perlu restok" : "Stok aman"}
                          </Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Belum ada jenis pakan"
              description="Tambahkan jenis pakan lalu catat pembelian untuk mengisi stok."
            />
          )
        ) : tab === "purchase" ? (
          purchases.length ? (
            <div className="table-responsive">
              <table className="table farm-table">
                <thead>
                  <tr>
                    <th>Nomor nota</th>
                    <th>Pemasok</th>
                    <th>Rincian pakan</th>
                    <th className="text-end">Total</th>
                    <th>Pembayaran</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.number}</strong>
                        <small className="cell-sub">{dateLabel(p.date)}</small>
                      </td>
                      <td>{p.supplier}</td>
                      <td>
                        {p.items.map((item, i) => (
                          <small className="cell-sub" key={i}>
                            {state.feeds.find((f) => f.id === item.feed_id)
                              ?.name || "Pakan"}{" "}
                            · {number(item.quantity)} kg ×{" "}
                            {money(item.unit_price)}
                          </small>
                        ))}
                      </td>
                      <td className="text-end fw-semibold">{money(p.total)}</td>
                      <td>
                        <Pill tone={p.balance === 0 ? "success" : "warning"}>
                          {p.balance === 0
                            ? "Lunas"
                            : p.paid > 0
                              ? "Sebagian"
                              : "Belum lunas"}
                        </Pill>
                        {p.balance > 0 && (
                          <small className="cell-sub">
                            Sisa {money(p.balance)}
                          </small>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-light"
                          disabled={downloading === p.id}
                          onClick={() => void download(p)}
                        >
                          <ArrowDownToLine size={15} />
                          {downloading === p.id ? "Memuat…" : "PDF"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Belum ada pembelian yang sesuai"
              description="Pembelian pakan otomatis menghasilkan nota yang dapat diunduh."
            />
          )
        ) : usages.length ? (
          <div className="table-responsive">
            <table className="table farm-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Jenis pakan</th>
                  <th>Kandang penerima</th>
                  <th className="text-end">Pemakaian</th>
                  <th>Pencatat</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {usages.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <RecordDate date={u.date} />
                    </td>
                    <td>
                      <strong>
                        {state.feeds.find((f) => f.id === u.feed_id)?.name ||
                          "Pakan"}
                      </strong>
                    </td>
                    <td>
                      {state.barns.find((b) => b.id === u.barn_id)?.name || "—"}
                    </td>
                    <td className="text-end fw-semibold">
                      {number(u.quantity)} kg
                    </td>
                    <td>
                      {state.users.find((p) => p.id === u.user_id)?.name ||
                        "Karyawan"}
                    </td>
                    <td className="notes-cell">{u.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Belum ada pemakaian yang sesuai"
            description="Catat jumlah pakan yang digunakan pada tiap kandang."
          />
        )}
        <TableEnd
          count={
            tab === "stock"
              ? feeds.length
              : tab === "purchase"
                ? purchases.length
                : usages.length
          }
        />
      </section>
    </>
  );
}
function PricesPage({ open }: { open: OpenForm }) {
  const { state, user } = useFarm();
  const price = activePrice(state);
  const now = Date.now();
  const rows = [...state.prices].sort(
    (a, b) =>
      new Date(b.effective_at).getTime() - new Date(a.effective_at).getTime(),
  );
  return (
    <>
      <Heading
        eyebrow="HARGA JUAL HARIAN"
        title="Harga telur"
        description="Satu acuan harga untuk seluruh tim penjualan."
      >
        {user?.role === "admin" && (
          <AddButton onClick={() => open("price")}>Perbarui harga</AddButton>
        )}
      </Heading>
      <div className="price-cards">
        <div className="price-feature good">
          <div className="d-flex justify-content-between align-items-start">
            <span className="icon-box">
              <Egg size={25} />
            </span>
            <Pill tone="success">Harga aktif</Pill>
          </div>
          <span>Telur bagus</span>
          <h2>
            {price ? money(price.good_price) : "Belum diatur"}
            <small>/ kg</small>
          </h2>
          <p>
            {price
              ? `Berlaku sejak ${dateLabel(price.effective_at, true)}`
              : "Hubungi atasan untuk menetapkan harga."}
          </p>
        </div>
        <div className="price-feature cracked">
          <div className="d-flex justify-content-between align-items-start">
            <span className="icon-box orange">
              <Egg size={25} />
            </span>
            <Pill tone="warning">Harga aktif</Pill>
          </div>
          <span>Telur bentes</span>
          <h2>
            {price
              ? price.cracked_price === 0
                ? "Gratis"
                : money(price.cracked_price)
              : "Belum diatur"}
            <small>/ kg</small>
          </h2>
          <p>
            {price
              ? `Berlaku sejak ${dateLabel(price.effective_at, true)}`
              : "Hubungi atasan untuk menetapkan harga."}
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Riwayat perubahan harga</h2>
            <p>Harga terjadwal aktif otomatis sesuai tanggal dan waktu WIB.</p>
          </div>
          <span className="icon-box">
            <History size={19} />
          </span>
        </div>
        {rows.length ? (
          <div className="table-responsive">
            <table className="table farm-table">
              <thead>
                <tr>
                  <th>Mulai berlaku</th>
                  <th className="text-end">Telur bagus / kg</th>
                  <th className="text-end">Telur bentes / kg</th>
                  <th>Ditetapkan oleh</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>{dateLabel(p.effective_at, true)}</td>
                    <td className="text-end fw-semibold">
                      {money(p.good_price)}
                    </td>
                    <td className="text-end fw-semibold">
                      {p.cracked_price === 0
                        ? "Gratis"
                        : money(p.cracked_price)}
                    </td>
                    <td>
                      {state.users.find((u) => u.id === p.created_by)?.name ||
                        "Admin"}
                    </td>
                    <td>
                      <Pill
                        tone={
                          price?.id === p.id
                            ? "success"
                            : new Date(p.effective_at).getTime() > now
                              ? "blue"
                              : "neutral"
                        }
                      >
                        {price?.id === p.id
                          ? "Sedang berlaku"
                          : new Date(p.effective_at).getTime() > now
                            ? "Terjadwal"
                            : "Riwayat"}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Belum ada riwayat harga" />
        )}
        <TableEnd count={rows.length} label="ketentuan harga" />
      </section>
    </>
  );
}
function EmployeesPage({ open }: { open: OpenForm }) {
  const { state, user, command } = useFarm();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState<User | null>(null);
  const [decision, setDecision] = useState<{
    employee: User;
    approve: boolean;
  } | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [decisionNotice, setDecisionNotice] = useState("");
  const action = useAction();
  const registrationState = (employee: User) =>
    employee.registration_status || "approved";
  const pendingCount = state.users.filter(
    (u) => registrationState(u) === "pending",
  ).length;
  const accountStatus = (employee: User) =>
    registrationState(employee) === "approved"
      ? employee.active
        ? "active"
        : "inactive"
      : registrationState(employee);
  function reviewRegistration(employee: User, approve: boolean) {
    setDecisionError("");
    setDecisionNotice("");
    setDecision({ employee, approve });
  }
  async function submitDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!decision || decisionBusy) return;
    setDecisionBusy(true);
    setDecisionError("");
    try {
      await command(decision.approve ? "user.approve" : "user.reject", {
        id: decision.employee.id,
      });
      setDecisionNotice(
        decision.approve
          ? `Pendaftaran ${decision.employee.name} disetujui. Akun sudah dapat masuk sebagai karyawan.`
          : `Pendaftaran ${decision.employee.name} ditolak. Akun tidak dapat masuk ke aplikasi.`,
      );
      setDecision(null);
    } catch (err) {
      setDecisionError(errorMessage(err));
    } finally {
      setDecisionBusy(false);
    }
  }
  const month = today().slice(0, 7);
  const sales = state.sales.filter(
    (s) => businessDate(s.date).slice(0, 7) === month,
  );
  const omzet = (id: string) =>
    sales.filter((s) => s.user_id === id).reduce((sum, s) => sum + s.total, 0);
  const rows = state.users
    .filter(
      (u) =>
        `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()) &&
        (!status || accountStatus(u) === status),
    )
    .sort((a, b) => omzet(b.id) - omzet(a.id));
  if (user?.role !== "admin")
    return (
      <Empty
        title="Akses khusus atasan"
        description="Pengelolaan akun karyawan tersedia untuk admin."
      />
    );
  return (
    <>
      <Heading
        eyebrow="TIM & PERFORMA"
        title="Karyawan"
        description="Kelola akses dan lihat perkembangan tim setiap bulan."
      >
        <AddButton onClick={() => open("user")}>Tambah karyawan</AddButton>
      </Heading>
      {action.feedback}
      {decisionNotice && (
        <div className="alert alert-success" role="status">
          {decisionNotice}
        </div>
      )}
      {pendingCount > 0 && (
        <div className="registration-review-notice">
          <ShieldCheck size={22} />
          <div>
            <strong>{pendingCount} pendaftaran menunggu persetujuan</strong>
            <p>
              Periksa nama dan email sebelum memberikan akses ke peternakan.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              setStatus("pending");
              setSearch("");
            }}
          >
            Lihat pendaftaran
          </button>
        </div>
      )}
      <Stats
        items={[
          {
            label: "Anggota tim",
            value: String(
              state.users.filter((u) => registrationState(u) === "approved")
                .length,
            ),
            note: "Termasuk atasan dan karyawan",
            icon: <Users size={22} />,
          },
          {
            label: "Akun aktif",
            value: String(state.users.filter((u) => u.active).length),
            note: "Dapat masuk ke aplikasi",
            icon: <ShieldCheck size={22} />,
            tone: "blue",
          },
          {
            label: "Omzet bulan ini",
            value: money(sales.reduce((sum, s) => sum + s.total, 0)),
            note: `${new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(`${today()}T00:00:00+07:00`))}`,
            icon: <TrendingUp size={22} />,
            tone: "orange",
          },
        ]}
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Tim TernaKu</h2>
            <p>Diurutkan berdasarkan omzet tertinggi bulan ini.</p>
          </div>
          <Pill>Insentif · Segera hadir</Pill>
        </div>
        <div className="module-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              className="form-control"
              aria-label="Cari nama atau email karyawan"
              placeholder="Cari nama atau email karyawan…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="form-select filter-select"
            aria-label="Filter status karyawan"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Semua status</option>
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
            <option value="pending">Menunggu persetujuan</option>
            <option value="rejected">Ditolak</option>
          </select>
        </div>
        {rows.length ? (
          <div className="table-responsive">
            <table className="table farm-table">
              <thead>
                <tr>
                  <th>Karyawan</th>
                  <th>Peran</th>
                  <th className="text-end">Penjualan bulan ini</th>
                  <th>Target bulanan</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const total = omzet(u.id),
                    percent =
                      u.target > 0 ? Math.round((total / u.target) * 100) : 0;
                  return (
                    <tr key={u.id}>
                      <td>
                        <Person name={u.name} small={u.email} />
                      </td>
                      <td>
                        <Pill tone={u.role === "admin" ? "blue" : "neutral"}>
                          {u.role === "admin" ? "Atasan" : "Karyawan"}
                        </Pill>
                      </td>
                      <td className="text-end fw-semibold">
                        {money(total)}
                        <small className="cell-sub">
                          {sales.filter((s) => s.user_id === u.id).length}{" "}
                          transaksi
                        </small>
                      </td>
                      <td>
                        <div className="target-cell">
                          <div>
                            <span>{money(u.target)}</span>
                            <strong>{percent}%</strong>
                          </div>
                          <div
                            className="progress"
                            role="progressbar"
                            aria-label={`Target ${u.name}`}
                            aria-valuenow={Math.min(percent, 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className="progress-bar"
                              style={{ width: `${Math.min(percent, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <Pill
                          tone={
                            registrationState(u) === "pending"
                              ? "warning"
                              : registrationState(u) === "rejected"
                                ? "danger"
                                : u.active
                                  ? "success"
                                  : "neutral"
                          }
                        >
                          {registrationState(u) === "pending"
                            ? "Menunggu persetujuan"
                            : registrationState(u) === "rejected"
                              ? "Ditolak"
                              : u.active
                                ? "Aktif"
                                : "Nonaktif"}
                        </Pill>
                      </td>
                      <td>
                        <div className="table-actions">
                          {registrationState(u) !== "approved" ? (
                            <>
                              <button
                                className="btn btn-sm btn-outline-primary"
                                disabled={decisionBusy}
                                onClick={() => reviewRegistration(u, true)}
                              >
                                <Check size={14} />{" "}
                                {registrationState(u) === "rejected"
                                  ? "Setujui ulang"
                                  : "Setujui"}
                              </button>
                              {registrationState(u) === "pending" && (
                                <button
                                  className="btn btn-sm btn-light text-danger"
                                  disabled={decisionBusy}
                                  onClick={() => reviewRegistration(u, false)}
                                >
                                  <X size={14} /> Tolak
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <button
                                className="icon-btn"
                                aria-label={`Edit ${u.name}`}
                                title="Edit nama dan target"
                                onClick={() => setEdit(u)}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                className="btn btn-sm btn-light"
                                disabled={action.busy || u.id === user.id}
                                title={
                                  u.id === user.id
                                    ? "Akun sendiri tidak dapat dinonaktifkan"
                                    : undefined
                                }
                                onClick={() =>
                                  void action.run(
                                    "user.update",
                                    { id: u.id, active: !u.active },
                                    `Akun ${u.name} ${u.active ? "dinonaktifkan" : "diaktifkan"}.`,
                                  )
                                }
                              >
                                {u.active ? "Nonaktifkan" : "Aktifkan"}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Karyawan tidak ditemukan" />
        )}
        <TableEnd count={rows.length} label="anggota tim" />
      </section>
      {edit && <EmployeeDialog employee={edit} onClose={() => setEdit(null)} />}
      {decision && (
        <Dialog
          title={
            decision.approve ? "Setujui pendaftaran?" : "Tolak pendaftaran?"
          }
          subtitle="Tinjau akses karyawan"
          onClose={() => {
            if (!decisionBusy) setDecision(null);
          }}
        >
          <form onSubmit={submitDecision}>
            <div className="modal-body-custom">
              <Person
                name={decision.employee.name}
                small={decision.employee.email}
              />
              <p className="mt-3 mb-0">
                {decision.approve
                  ? "Akun ini akan aktif sebagai karyawan di peternakan Anda dan dapat mulai mencatat produksi serta penjualan."
                  : "Akun ini tidak akan mendapat akses ke peternakan. Anda tetap dapat menyetujuinya kembali dari daftar akun yang ditolak."}
              </p>
              {decisionError && (
                <div className="alert alert-danger mt-3 mb-0" role="alert">
                  {decisionError}
                </div>
              )}
            </div>
            <div className="modal-footer-custom">
              <button
                type="button"
                className="btn btn-light"
                disabled={decisionBusy}
                onClick={() => setDecision(null)}
              >
                Batal
              </button>
              <button
                type="submit"
                className={`btn ${decision.approve ? "btn-primary" : "btn-danger"}`}
                disabled={decisionBusy}
              >
                {decisionBusy
                  ? "Menyimpan…"
                  : decision.approve
                    ? "Setujui & aktifkan"
                    : "Tolak pendaftaran"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
const actionLabels: Record<string, string> = {
  "production.create": "Produksi dicatat",
  "pickup.create": "Pengambilan telur",
  "pickup.return": "Pengembalian telur",
  "sale.create": "Penjualan dicatat",
  "sale.payment": "Pembayaran diterima",
  "price.create": "Harga diperbarui",
  "user.create": "Akun dibuat",
  "user.update": "Akun diperbarui",
  "profile.update": "Profil diperbarui",
  "user.register": "Akun didaftarkan",
  "user.approve": "Pendaftaran disetujui",
  "user.reject": "Pendaftaran ditolak",
  "feed.create": "Jenis pakan ditambahkan",
  "feed.purchase": "Pembelian pakan",
  "feed.use": "Pemakaian pakan",
  "barn.create": "Kandang ayam ditambahkan",
  "correction.apply": "Data dikoreksi",
  "correction.request": "Koreksi diajukan",
  "correction.review": "Koreksi ditinjau",
  "record.lock": "Status kunci berubah",
  "auth.login": "Masuk aplikasi",
  "auth.logout": "Keluar aplikasi",
};
function ActivityPage() {
  const { state, user } = useFarm();
  const filters = useFilters();
  const rows = state.activity
    .filter(
      (a) =>
        inRange(a.created_at, filters.from, filters.to) &&
        `${actionLabels[a.action] || a.action} ${a.description} ${state.users.find((u) => u.id === a.user_id)?.name}`
          .toLowerCase()
          .includes(filters.search.toLowerCase()),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (user?.role !== "admin")
    return (
      <Empty
        title="Akses khusus atasan"
        description="Log aktivitas hanya dapat diakses admin."
      />
    );
  return (
    <>
      <Heading
        eyebrow="TRANSPARANSI OPERASIONAL"
        title="Log aktivitas"
        description="Jejak pencatatan dan perubahan untuk membantu penelusuran."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Aktivitas pengguna</h2>
            <p>Termasuk alasan perubahan dan data sebelum / sesudah koreksi.</p>
          </div>
          <ShieldCheck size={22} />
        </div>
        <Filters
          {...filters}
          placeholder="Cari aktivitas, karyawan, atau alasan…"
        />
        {rows.length ? (
          <div className="activity-list">
            {rows.map((a) => (
              <div className="activity-item" key={a.id}>
                <span className="activity-dot">
                  <History size={16} />
                </span>
                <div className="flex-grow-1">
                  <div className="d-flex flex-wrap justify-content-between gap-2">
                    <strong>{actionLabels[a.action] || a.action}</strong>
                    <time>{dateLabel(a.created_at, true)}</time>
                  </div>
                  <p>{a.description}</p>
                  <small>
                    {state.users.find((u) => u.id === a.user_id)?.name ||
                      "Sistem"}
                  </small>
                  {(a.before !== undefined || a.after !== undefined) && (
                    <details className="audit-details">
                      <summary>Lihat rincian perubahan</summary>
                      <div className="row g-3 mt-1">
                        <div className="col-md-6">
                          <small>Sebelum</small>
                          <pre>{JSON.stringify(a.before ?? null, null, 2)}</pre>
                        </div>
                        <div className="col-md-6">
                          <small>Sesudah</small>
                          <pre>{JSON.stringify(a.after ?? null, null, 2)}</pre>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Belum ada aktivitas yang sesuai" />
        )}
        <TableEnd count={rows.length} label="aktivitas" />
      </section>
    </>
  );
}
function CorrectionsPage() {
  const { state, user } = useFarm();
  const filters = useFilters();
  const [status, setStatus] = useState("");
  const action = useAction();
  const entityNames = {
    production: "Produksi telur",
    pickup: "Pengambilan telur",
    sale: "Penjualan telur",
  };
  const fieldNames: Record<string, string> = {
    items: "Item penjualan",
    eggs: "Jumlah butir",
    kg: "Berat (kg)",
    trays: "Jumlah krat",
    notes: "Catatan",
    customer: "Pelanggan",
    area: "Tujuan penjualan",
  };
  const rows = state.corrections
    .filter(
      (c) =>
        (user?.role === "admin" || c.user_id === user?.id) &&
        (!status || c.status === status) &&
        inRange(c.created_at, filters.from, filters.to) &&
        `${c.reason} ${state.users.find((u) => u.id === c.user_id)?.name} ${entityNames[c.entity]}`
          .toLowerCase()
          .includes(filters.search.toLowerCase()),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <>
      <Heading
        eyebrow="PEMERIKSAAN DATA"
        title="Pengajuan koreksi"
        description={
          user?.role === "admin"
            ? "Tinjau perubahan yang diajukan karyawan sebelum diterapkan."
            : "Pantau status pengajuan perubahan pencatatan Anda."
        }
      />
      {action.feedback}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Daftar pengajuan</h2>
            <p>
              Ajukan koreksi dari tombol pensil pada data produksi, pengambilan,
              atau penjualan.
            </p>
          </div>
          <Pill tone="warning">
            {state.corrections.filter((c) => c.status === "pending").length}{" "}
            menunggu
          </Pill>
        </div>
        <Filters
          {...filters}
          placeholder="Cari alasan, karyawan, atau jenis data…"
        >
          <select
            className="form-select filter-select"
            aria-label="Status pengajuan"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Semua status</option>
            <option value="pending">Menunggu</option>
            <option value="approved">Disetujui</option>
            <option value="rejected">Ditolak</option>
          </select>
        </Filters>
        {rows.length ? (
          <div className="correction-list">
            {rows.map((c) => (
              <article className="correction-card" key={c.id}>
                <div className="d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <h3>{entityNames[c.entity]}</h3>
                    <small className="text-muted">
                      {state.users.find((u) => u.id === c.user_id)?.name ||
                        "Karyawan"}{" "}
                      · {dateLabel(c.created_at, true)}
                    </small>
                  </div>
                  <Pill
                    tone={
                      c.status === "approved"
                        ? "success"
                        : c.status === "pending"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {c.status === "approved"
                      ? "Disetujui"
                      : c.status === "pending"
                        ? "Menunggu"
                        : "Ditolak"}
                  </Pill>
                </div>
                <p className="mt-3 mb-2">
                  <strong>Alasan:</strong> {c.reason}
                </p>
                <div className="correction-changes">
                  {Object.entries(c.changes).map(([key, value]) => (
                    <div key={key}>
                      <small>{fieldNames[key] || key}</small>
                      <span style={{ whiteSpace: "pre-line" }}>
                        {key === "items" && Array.isArray(value)
                          ? value
                              .map(
                                (
                                  item: {
                                    id: string;
                                    eggs: number;
                                    kg: number;
                                    trays: number;
                                  },
                                  index: number,
                                ) => {
                                  const original = state.sales
                                    .find((s) => s.id === c.record_id)
                                    ?.items.find((line) => line.id === item.id);
                                  return `${index + 1}. ${original ? categoryLabel(original.category) : "Telur"}: ${number(item.eggs)} butir, ${number(item.kg)} kg, ${number(item.trays)} krat`;
                                },
                              )
                              .join("\n")
                          : String(value) || "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {c.reviewed_at && (
                  <small className="text-muted d-block mt-3">
                    Ditinjau {dateLabel(c.reviewed_at, true)} oleh{" "}
                    {state.users.find((u) => u.id === c.reviewed_by)?.name ||
                      "Atasan"}
                  </small>
                )}
                {c.status === "pending" && user?.role === "admin" && (
                  <div className="d-flex gap-2 justify-content-end mt-3">
                    <button
                      className="btn btn-sm btn-light"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(
                          "correction.review",
                          { id: c.id, approved: false },
                          "Pengajuan koreksi ditolak.",
                        )
                      }
                    >
                      <X size={16} />
                      Tolak
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(
                          "correction.review",
                          { id: c.id, approved: true },
                          "Koreksi disetujui dan diterapkan.",
                        )
                      }
                    >
                      <Check size={16} />
                      Setujui perubahan
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Belum ada pengajuan yang sesuai"
            description="Setiap pengajuan koreksi akan dapat dipantau di sini."
          />
        )}
        <TableEnd count={rows.length} label="pengajuan" />
      </section>
    </>
  );
}
export function Modules({ page }: { page: string }) {
  const [kind, setKind] = useState<string | null>(null);
  return (
    <>
      {page === "production" || page === "productions" ? (
        <ProductionPage open={setKind} />
      ) : page === "sales" ? (
        <SalesPage open={setKind} />
      ) : page === "stock" || page === "pickups" ? (
        <StockPage open={setKind} />
      ) : page === "feed" ? (
        <FeedPage open={setKind} />
      ) : page === "prices" ? (
        <PricesPage open={setKind} />
      ) : page === "employees" || page === "users" ? (
        <EmployeesPage open={setKind} />
      ) : page === "activity" ? (
        <ActivityPage />
      ) : page === "corrections" ? (
        <CorrectionsPage />
      ) : (
        <Empty
          title="Segera hadir"
          description="Fitur ini sedang disiapkan untuk pembaruan berikutnya."
        />
      )}
      <EntryModal
        key={kind || "closed"}
        kind={kind}
        onClose={() => setKind(null)}
      />
    </>
  );
}
export default Modules;
