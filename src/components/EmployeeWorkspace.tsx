"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ClipboardList,
  Egg,
  House,
  LogOut,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Undo2,
  Wheat,
  X,
} from "lucide-react";
import { useFarm } from "@/lib/store";
import {
  activePrice,
  businessDate,
  dateLabel,
  eggStock,
  money,
  number,
  pickupBalance,
  today,
} from "@/lib/domain";
import type { Pickup, Sale } from "@/lib/types";
import EntryModal from "./EntryModal";
import InstallApp from "./InstallApp";
import Modules from "./Modules";
import Reports from "./Reports";
import { categoryLabel, Dialog } from "./ModuleUI";
import {
  CorrectionDialog,
  PaymentDialog,
  ReturnDialog,
  SaleDetail,
  type SelectedRecord,
} from "./RecordDialogs";
import styles from "./EmployeeWorkspace.module.css";

type Page =
  | "home"
  | "production"
  | "sales"
  | "stock"
  | "feed"
  | "reports"
  | "corrections";
const tabs = [
  { id: "home", label: "Beranda", icon: House },
  { id: "production", label: "Panen", icon: Egg },
  { id: "sales", label: "Jual", icon: ShoppingBag },
  { id: "stock", label: "Gudang", icon: Package },
] as const;
const pageNames: Record<Page, string> = {
  home: "Beranda",
  production: "Catatan panen",
  sales: "Catatan penjualan",
  stock: "Telur di gudang",
  feed: "Pakan ternak",
  reports: "Laporan saya",
  corrections: "Perbaikan catatan",
};
const quantity = (value: number) => number(value, 3);
const latest = <T extends { created_at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

export default function EmployeeWorkspace() {
  const { state, user, logout, command, refresh, error, mode, priceSync } =
    useFarm();
  const [page, setPage] = useState<Page>("home");
  const [modal, setModal] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<{
    message: string;
    at: number;
  } | null>(null);
  const [more, setMore] = useState(false);
  const [shown, setShown] = useState(8);
  const [returnPickup, setReturnPickup] = useState<Pickup | null>(null);
  const [saleDetail, setSaleDetail] = useState<Sale | null>(null);
  const [paymentSale, setPaymentSale] = useState<Sale | null>(null);
  const [correction, setCorrection] = useState<SelectedRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash.slice(1).replace(/^employee-/, "");
      if (Object.hasOwn(pageNames, hash)) {
        setPage(hash as Page);
        setShown(8);
      }
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(null), 8000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  if (!user) return null;
  const go = (next: Page) => {
    setPage(next);
    setShown(8);
    setMore(false);
    window.location.hash = `employee-${next}`;
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const price = activePrice(state);
  const ownProductions = latest(
    state.productions.filter((row) => row.user_id === user.id),
  );
  const ownSales = latest(state.sales.filter((row) => row.user_id === user.id));
  const ownPickups = latest(
    state.pickups.filter((row) => row.user_id === user.id),
  );
  const carried = ownPickups
    .map((pickup) => ({ pickup, balance: pickupBalance(state, pickup) }))
    .filter(({ balance }) => balance.eggs > 0 || balance.kg > 0);
  const notifications = latest(
    state.notifications.filter((row) => row.user_id === user.id),
  );
  const unread = notifications.filter((row) => !row.read).length;
  const day = today();
  const harvestedToday = ownProductions.filter(
    (row) => businessDate(row.date) === day,
  );
  const salesToday = ownSales.filter((row) => businessDate(row.date) === day);
  const checkedAt = priceSync.lastSuccessAt
    ? new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(priceSync.lastSuccessAt))
    : null;
  const optionalPage = ["feed", "reports", "corrections"].includes(page);
  const goodStock = eggStock(state, "good");
  const crackedStock = eggStock(state, "cracked");

  async function reload() {
    setRefreshing(true);
    setNotice("");
    try {
      await refresh();
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Data belum dapat diperbarui.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <button
          className={styles.brand}
          onClick={() => go("home")}
          aria-label="TernaKu, ke beranda"
        >
          <span>
            <Egg size={25} />
          </span>
          Terna<strong>Ku</strong>
        </button>
        <div className={styles.headerActions}>
          {mode === "demo" && <span className={styles.demo}>Demo</span>}
          <button
            className={styles.bell}
            onClick={() => setNotificationsOpen(true)}
            aria-label={`Pemberitahuan, ${unread} belum dibaca`}
          >
            <Bell size={23} />
            {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
          </button>
        </div>
      </header>

      <section
        className={styles.priceDock}
        aria-label="Harga telur yang berlaku"
      >
        <div className={styles.priceTitle}>
          <strong>Harga telur hari ini</strong>
          <span>
            <i
              className={priceSync.error ? styles.offlineDot : styles.liveDot}
            />{" "}
            Cek tiap 5 detik
          </span>
        </div>
        <div className={styles.prices} aria-live="polite" aria-atomic="true">
          <div className={styles.goodPrice}>
            <span>
              <Egg size={17} /> Telur bagus
            </span>
            <strong>
              {price ? money(price.good_price) : "Belum ada"}
              {price && <small>/kg</small>}
            </strong>
          </div>
          <div className={styles.crackedPrice}>
            <span>
              <Egg size={17} /> Telur bentes
            </span>
            <strong>
              {price ? money(price.cracked_price) : "Belum ada"}
              {price && <small>/kg</small>}
            </strong>
          </div>
        </div>
        <p
          className={`${styles.priceStatus} ${priceSync.error ? styles.priceWarning : ""}`}
        >
          {priceSync.error
            ? "Belum terhubung. Harga di atas adalah harga terakhir."
            : checkedAt
              ? `Terakhir dicek ${checkedAt} WIB`
              : priceSync.refreshing
                ? "Sedang memeriksa harga…"
                : "Menunggu pemeriksaan harga…"}
        </p>
      </section>

      <main className={styles.main} id="main-content">
        {(error || notice) && (
          <div className={styles.warning} role="alert">
            <p>{notice || error}</p>
            <button onClick={() => void reload()} disabled={refreshing}>
              <RefreshCw size={17} /> Coba lagi
            </button>
          </div>
        )}
        {!price && (
          <div className={styles.warning} role="status">
            Harga jual belum ditetapkan atasan. Panen tetap bisa dicatat.
          </div>
        )}

        {page === "home" && (
          <>
            <div className={styles.welcome}>
              <div>
                <span>{dateLabel(day)}</span>
                <h1>
                  Halo, {user.name.split(" ")[0]}{" "}
                  <span aria-hidden="true">☀️</span>
                </h1>
                <p>Mau mencatat apa hari ini?</p>
              </div>
            </div>
            <div className={styles.mainActions}>
              <button
                className={styles.harvestAction}
                onClick={() => setModal("production")}
              >
                <span className={styles.actionIcon}>
                  <Egg size={31} />
                </span>
                <strong>Catat panen</strong>
                <span>Telur dari kandang</span>
                <Plus size={19} className={styles.actionPlus} />
              </button>
              <button
                className={styles.saleAction}
                onClick={() => setModal("sale")}
                disabled={!price}
              >
                <span className={styles.actionIcon}>
                  <ShoppingBag size={30} />
                </span>
                <strong>Catat jual</strong>
                <span>Telur yang terjual</span>
                <Plus size={19} className={styles.actionPlus} />
              </button>
            </div>
            <button
              className={styles.warehouseAction}
              onClick={() => go("stock")}
            >
              <span className={styles.warehouseIcon}>
                <Package size={27} />
              </span>
              <span>
                <strong>Lihat gudang</strong>
                <small>Jumlah telur bagus & bentes</small>
              </span>
              <ArrowRight size={22} />
            </button>
            <InstallApp />
            <section
              className={styles.section}
              aria-label="Catatan saya hari ini"
            >
              <h2>Catatan saya hari ini</h2>
              <div className={styles.todayGrid}>
                <button onClick={() => go("production")}>
                  <span>Panen</span>
                  <strong>
                    {quantity(
                      harvestedToday.reduce((sum, row) => sum + row.kg, 0),
                    )}{" "}
                    <small>kg</small>
                  </strong>
                  <small>
                    {number(
                      harvestedToday.reduce((sum, row) => sum + row.eggs, 0),
                    )}{" "}
                    butir
                  </small>
                </button>
                <button onClick={() => go("sales")}>
                  <span>Penjualan</span>
                  <strong className={styles.revenue}>
                    {money(salesToday.reduce((sum, row) => sum + row.total, 0))}
                  </strong>
                  <small>{number(salesToday.length)} transaksi</small>
                </button>
              </div>
            </section>
            {carried.length > 0 && (
              <button
                className={styles.carryReminder}
                onClick={() => go("stock")}
              >
                <Package size={21} />
                <span>
                  Anda masih membawa{" "}
                  <strong>
                    {quantity(
                      carried.reduce((sum, row) => sum + row.balance.kg, 0),
                    )}{" "}
                    kg telur
                  </strong>
                  .
                </span>
                <ArrowRight size={18} />
              </button>
            )}
            <section className={styles.moreSection}>
              <button
                className={styles.moreToggle}
                onClick={() => setMore(!more)}
                aria-expanded={more}
                aria-controls="employee-more"
              >
                <span>Menu lainnya</span>
                <ChevronDown size={20} className={more ? styles.rotate : ""} />
              </button>
              {more && (
                <div id="employee-more" className={styles.moreMenu}>
                  <button onClick={() => go("feed")}>
                    <Wheat size={21} /> Pakan ternak <ArrowRight size={17} />
                  </button>
                  <button onClick={() => go("reports")}>
                    <ClipboardList size={21} /> Laporan saya{" "}
                    <ArrowRight size={17} />
                  </button>
                  <button onClick={() => go("corrections")}>
                    <Pencil size={20} /> Perbaikan catatan{" "}
                    <ArrowRight size={17} />
                  </button>
                  <button onClick={() => void reload()} disabled={refreshing}>
                    <RefreshCw size={20} />{" "}
                    {refreshing ? "Memperbarui…" : "Perbarui semua data"}
                  </button>
                  <div className={styles.account}>
                    <span>Masuk sebagai</span>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </div>
                  <button
                    onClick={() =>
                      void logout().catch((cause: unknown) =>
                        setNotice(
                          cause instanceof Error
                            ? cause.message
                            : "Belum dapat keluar. Coba lagi.",
                        ),
                      )
                    }
                  >
                    <LogOut size={20} /> Keluar akun
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {page === "production" && (
          <>
            <PageHeading
              title="Catatan panen"
              description="Panen yang Anda catat tersimpan di sini."
            />
            <button
              className={styles.primaryButton}
              onClick={() => setModal("production")}
            >
              <Plus size={23} /> Catat panen baru
            </button>
            <div className={styles.records}>
              {ownProductions.slice(0, shown).map((row) => (
                <article className={styles.record} key={row.id}>
                  <div className={styles.recordTop}>
                    <span
                      className={
                        row.category === "good"
                          ? styles.goodBadge
                          : styles.crackedBadge
                      }
                    >
                      {categoryLabel(row.category)}
                    </span>
                    <small>{dateLabel(row.date)}</small>
                  </div>
                  <div className={styles.recordQuantity}>
                    <strong>
                      {quantity(row.kg)} <small>kg</small>
                    </strong>
                    <span>
                      {number(row.eggs)} butir · {quantity(row.trays)} krat
                    </span>
                  </div>
                  <p>
                    {state.barns.find((barn) => barn.id === row.barn_id)
                      ?.name || "Kandang"}
                  </p>
                  {row.notes && <p className={styles.notes}>{row.notes}</p>}
                  <button
                    className={styles.textButton}
                    onClick={() =>
                      setCorrection({ entity: "production", record: row })
                    }
                  >
                    <Pencil size={17} />{" "}
                    {row.locked ? "Ajukan perbaikan" : "Perbaiki catatan"}
                  </button>
                </article>
              ))}
            </div>
            {ownProductions.length === 0 && (
              <EmptyNote
                icon="egg"
                title="Belum ada catatan panen"
                text="Tekan Catat panen baru untuk mulai."
              />
            )}
            {ownProductions.length > shown && (
              <MoreRecords onClick={() => setShown(shown + 8)} />
            )}
          </>
        )}

        {page === "sales" && (
          <>
            <PageHeading
              title="Catatan penjualan"
              description="Lihat penjualan dan nota Anda di sini."
            />
            <button
              className={styles.primaryButton}
              onClick={() => setModal("sale")}
              disabled={!price}
            >
              <Plus size={23} /> Catat penjualan baru
            </button>
            <div className={styles.records}>
              {ownSales.slice(0, shown).map((row) => (
                <article className={styles.record} key={row.id}>
                  <div className={styles.recordTop}>
                    <span
                      className={
                        row.balance === 0
                          ? styles.goodBadge
                          : styles.crackedBadge
                      }
                    >
                      {row.balance === 0
                        ? "Lunas"
                        : row.paid > 0
                          ? "Dibayar sebagian"
                          : "Belum lunas"}
                    </span>
                    <small>{dateLabel(row.date)}</small>
                  </div>
                  <h2 className={styles.saleTotal}>{money(row.total)}</h2>
                  <p>{row.customer || "Pelanggan umum"}</p>
                  <div className={styles.saleItems}>
                    {row.items.map((item) => (
                      <span key={item.id}>
                        {categoryLabel(item.category)} · {quantity(item.kg)} kg
                      </span>
                    ))}
                  </div>
                  {row.balance > 0 && (
                    <p className={styles.balance}>
                      Belum dibayar: <strong>{money(row.balance)}</strong>
                    </p>
                  )}
                  <div className={styles.recordButtons}>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => setSaleDetail(row)}
                    >
                      <ReceiptText size={18} /> Lihat nota
                    </button>
                    {row.balance > 0 && (
                      <button
                        className={styles.secondaryButton}
                        onClick={() => setPaymentSale(row)}
                      >
                        Catat pembayaran
                      </button>
                    )}
                  </div>
                  <button
                    className={styles.textButton}
                    onClick={() =>
                      setCorrection({ entity: "sale", record: row })
                    }
                  >
                    <Pencil size={17} /> Ajukan perbaikan
                  </button>
                </article>
              ))}
            </div>
            {ownSales.length === 0 && (
              <EmptyNote
                icon="sale"
                title="Belum ada penjualan"
                text="Setelah menjual telur, catat hasilnya di sini."
              />
            )}
            {ownSales.length > shown && (
              <MoreRecords onClick={() => setShown(shown + 8)} />
            )}
          </>
        )}

        {page === "stock" && (
          <>
            <PageHeading
              title="Telur di gudang"
              description="Jumlah telur yang tersedia untuk diambil."
            />
            <div className={styles.stockCards}>
              {[
                { label: "Telur bagus", stock: goodStock, good: true },
                { label: "Telur bentes", stock: crackedStock, good: false },
              ].map(({ label, stock, good }) => (
                <article
                  className={good ? styles.goodStock : styles.crackedStock}
                  key={label}
                >
                  <span>
                    <Egg size={21} /> {label}
                  </span>
                  <strong>
                    {quantity(stock.kg)} <small>kg</small>
                  </strong>
                  <p>{number(stock.eggs)} butir</p>
                  <small>{quantity(stock.trays)} krat</small>
                </article>
              ))}
            </div>
            <button
              className={styles.primaryButton}
              onClick={() => setModal("pickup")}
            >
              <Package size={22} /> Ambil telur untuk dijual
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setModal("production")}
            >
              <Plus size={20} /> Catat panen masuk gudang
            </button>
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <h2>Telur yang saya bawa</h2>
                <span>{carried.length} pengambilan</span>
              </div>
              {carried.length === 0 && (
                <EmptyNote
                  icon="stock"
                  title="Tidak ada telur yang dibawa"
                  text="Ambil telur dari gudang sebelum mencatat penjualan."
                />
              )}
              <div className={styles.records}>
                {carried.map(({ pickup, balance }) => (
                  <article className={styles.record} key={pickup.id}>
                    <div className={styles.recordTop}>
                      <span
                        className={
                          pickup.category === "good"
                            ? styles.goodBadge
                            : styles.crackedBadge
                        }
                      >
                        {categoryLabel(pickup.category)}
                      </span>
                      <small>{dateLabel(pickup.date)}</small>
                    </div>
                    <div className={styles.recordQuantity}>
                      <strong>
                        {quantity(balance.kg)} <small>kg tersisa</small>
                      </strong>
                      <span>
                        {number(balance.eggs)} butir · {quantity(balance.trays)}{" "}
                        krat
                      </span>
                    </div>
                    {pickup.area && <p>Tujuan: {pickup.area}</p>}
                    <div className={styles.recordButtons}>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => setModal("sale")}
                        disabled={!price}
                      >
                        <ShoppingBag size={18} /> Catat jual
                      </button>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => setReturnPickup(pickup)}
                      >
                        <Undo2 size={18} /> Kembalikan
                      </button>
                    </div>
                    <button
                      className={styles.textButton}
                      onClick={() =>
                        setCorrection({ entity: "pickup", record: pickup })
                      }
                    >
                      <Pencil size={17} /> Ajukan perbaikan
                    </button>
                  </article>
                ))}
              </div>
            </section>
            {ownPickups.length > carried.length && (
              <details className={styles.history}>
                <summary>Pengambilan yang sudah selesai</summary>
                {ownPickups
                  .filter(
                    (row) =>
                      !carried.some(({ pickup }) => pickup.id === row.id),
                  )
                  .map((row) => (
                    <div key={row.id}>
                      <div className={styles.historyRow}>
                        <span>
                          <strong>{categoryLabel(row.category)}</strong>
                          <small>
                            {dateLabel(row.date)} · {quantity(row.kg)} kg
                          </small>
                        </span>
                        <span>{pickupBalance(state, row).status}</span>
                      </div>
                      <button
                        className={styles.textButton}
                        onClick={() =>
                          setCorrection({ entity: "pickup", record: row })
                        }
                      >
                        <Pencil size={17} /> Ajukan perbaikan
                      </button>
                    </div>
                  ))}
              </details>
            )}
          </>
        )}

        {optionalPage && (
          <section className={styles.optionalPage}>
            <button className={styles.backButton} onClick={() => go("home")}>
              <ArrowLeft size={20} /> Kembali ke beranda
            </button>
            <h1 className={styles.srOnly}>{pageNames[page]}</h1>
            {page === "reports" ? <Reports /> : <Modules page={page} />}
          </section>
        )}
      </main>

      <nav className={styles.bottomNav} aria-label="Menu karyawan">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={page === id ? styles.activeTab : ""}
            aria-current={page === id ? "page" : undefined}
            onClick={() => go(id)}
          >
            <Icon size={23} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {confirmation && (
        <div className={styles.successToast} role="status" aria-atomic="true">
          <Check size={23} aria-hidden="true" />
          <span>{confirmation.message}</span>
          <button
            aria-label="Tutup pesan berhasil"
            onClick={() => setConfirmation(null)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      )}

      {modal && (
        <EntryModal
          key={modal}
          kind={modal}
          onClose={() => setModal(null)}
          onSaved={(action) => {
            setNotice("");
            setConfirmation({
              message:
                action === "production.create"
                  ? "Panen berhasil disimpan."
                  : action === "sale.create"
                    ? "Penjualan berhasil disimpan."
                    : action === "pickup.create"
                      ? "Pengambilan telur berhasil disimpan."
                      : "Catatan berhasil disimpan.",
              at: Date.now(),
            });
          }}
        />
      )}
      {returnPickup && (
        <ReturnDialog
          pickup={
            state.pickups.find((row) => row.id === returnPickup.id) ||
            returnPickup
          }
          onClose={() => setReturnPickup(null)}
        />
      )}
      {saleDetail && (
        <SaleDetail
          sale={
            state.sales.find((row) => row.id === saleDetail.id) || saleDetail
          }
          onClose={() => setSaleDetail(null)}
        />
      )}
      {paymentSale && (
        <PaymentDialog
          sale={
            state.sales.find((row) => row.id === paymentSale.id) || paymentSale
          }
          onClose={() => setPaymentSale(null)}
        />
      )}
      {correction && (
        <CorrectionDialog
          selected={correction}
          onClose={() => setCorrection(null)}
        />
      )}
      {notificationsOpen && (
        <Dialog
          title="Pemberitahuan"
          subtitle="Perubahan harga dan kabar dari atasan."
          onClose={() => setNotificationsOpen(false)}
        >
          <div className={styles.notifications}>
            {notifications.length === 0 && <p>Belum ada pemberitahuan.</p>}
            {notifications.map((row) => (
              <article
                key={row.id}
                className={
                  row.read ? styles.readNotification : styles.unreadNotification
                }
              >
                <strong>{row.title}</strong>
                <p>{row.message}</p>
                <small>{dateLabel(row.created_at, true)}</small>
                {!row.read && (
                  <button
                    onClick={async () => {
                      try {
                        await command("notification.read", { id: row.id });
                      } catch (cause) {
                        setNotice(
                          cause instanceof Error
                            ? cause.message
                            : "Pemberitahuan belum dapat ditandai.",
                        );
                        setNotificationsOpen(false);
                      }
                    }}
                  >
                    <Check size={18} /> Sudah dibaca
                  </button>
                )}
              </article>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PageHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.pageHeading}>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function EmptyNote({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: "egg" | "sale" | "stock";
}) {
  const Icon = icon === "egg" ? Egg : icon === "sale" ? ShoppingBag : Package;
  return (
    <div className={styles.empty}>
      <Icon size={35} strokeWidth={1.5} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
function MoreRecords({ onClick }: { onClick: () => void }) {
  return (
    <button className={styles.moreRecords} onClick={onClick}>
      Lihat catatan sebelumnya <ChevronDown size={18} />
    </button>
  );
}
