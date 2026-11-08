"use client";

import { InvoiceTasks } from "./InvoiceLedger";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ClipboardList,
  Egg,
  House,
  History,
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
  dateLabel,
  eggStock,
  isProductionStocked,
  money,
  number,
  pickupBalance,
  today,
} from "@/lib/domain";
import type { Pickup, Production, Sale } from "@/lib/types";
import { employeeHistoryWindow, employeeRecords, nextJakartaDayDelay } from "@/lib/employee-history";
import { NEW_EGG_TYPES, eggTypePrice } from "@/lib/egg-types";
import EntryModal from "./EntryModal";
import type { SaleStart } from "./SaleStockSource";
import InstallApp from "./InstallApp";
import PushNotifications from "./PushNotifications";
import ThemeToggle from "./ThemeToggle";
import ProfileSettings from "./ProfileSettings";
import Avatar from "./Avatar";
import ImagePreview from "./ImagePreview";
import PendingHarvest from "./PendingHarvest";
import StockChecks from "./StockChecks";
import { usePageNavigation } from "@/lib/navigation";
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
  | "history"
  | "team-records"
  | "invoices"
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
  history: "Riwayat saya",
  "team-records": "Catatan seluruh tim",
  invoices: "Tagihan saya",
  corrections: "Perbaikan catatan",
};
const quantity = (value: number) => number(value, 3);
const latest = <T extends { created_at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

export default function EmployeeWorkspace() {
  const { state, user, logout, command, refresh, error, mode, priceSync } =
    useFarm();
  const [page, navigate] = usePageNavigation(
    Object.keys(pageNames) as Page[],
    "home",
    "employee-",
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [saleStart, setSaleStart] = useState<SaleStart>();
  function openSale(start?: SaleStart) {
    setSaleStart(start);
    setModal("sale");
  }
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
  const [day, setDay] = useState(() => today());
  const [historyKind, setHistoryKind] = useState<"production" | "sales">("production");
  const [historyDates, setHistoryDates] = useState<{ from: string; to: string } | null>(null);
  const [historyEmployee, setHistoryEmployee] = useState("");
  const [productionDetail, setProductionDetail] = useState<Production | null>(null);
  const [readingNotification, setReadingNotification] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const notificationPending = useRef(false);

  useEffect(() => {
    let currentDay = today();
    let timer: number;
    const checkDay = () => {
      window.clearTimeout(timer);
      const nextDay = today();
      setDay(nextDay);
      if (currentDay !== nextDay) {
        currentDay = nextDay;
        void refresh().catch(() => {});
      }
      timer = window.setTimeout(checkDay, nextJakartaDayDelay());
    };
    const onVisible = () => { if (document.visibilityState === "visible") checkDay(); };
    checkDay();
    window.addEventListener("focus", checkDay);
    window.addEventListener("pageshow", checkDay);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkDay);
      window.removeEventListener("pageshow", checkDay);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    setShown(8);
    setMore(false);
  }, [page, day, historyKind, historyDates, historyEmployee]);

  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(null), 8000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  const historyWindow = useMemo(() => employeeHistoryWindow(day), [day]);
  const historyRange = historyDates ? {
    from: historyDates.from && historyDates.from < historyWindow.from ? historyWindow.from : historyDates.from > day ? day : historyDates.from,
    to: historyDates.to > day ? day : historyDates.to && historyDates.to < historyWindow.from ? historyWindow.from : historyDates.to,
  } : historyWindow;
  const teamHistory = page === "team-records" && user?.can_check_stock === true;
  const harvestedToday = useMemo(() => user ? employeeRecords(state.productions, user, { from: day, to: day }) : [], [state.productions, user?.id, day]);
  const salesToday = useMemo(() => user ? employeeRecords(state.sales, user, { from: day, to: day }) : [], [state.sales, user?.id, day]);
  const historyProductions = useMemo(() => user ? employeeRecords(state.productions, user, historyRange, teamHistory ? "team" : "mine", historyEmployee) : [],
    [state.productions, user?.id, user?.can_check_stock, historyRange.from, historyRange.to, teamHistory, historyEmployee]);
  const historySales = useMemo(() => user ? employeeRecords(state.sales, user, historyRange, teamHistory ? "team" : "mine", historyEmployee) : [],
    [state.sales, user?.id, user?.can_check_stock, historyRange.from, historyRange.to, teamHistory, historyEmployee]);
  const historyOwners = useMemo(() => {
    if (!teamHistory) return [];
    const ids = new Set([...state.productions, ...state.sales].map(row => row.user_id));
    return state.users.filter(owner => ids.has(owner.id));
  }, [state.users, state.productions, state.sales, teamHistory]);

  if (!user) return null;
  const go = (next: Page) => {
    navigate(next);
    setShown(8);
    setMore(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const price = activePrice(state);
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
  const checkedAt = priceSync.lastSuccessAt
    ? new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(priceSync.lastSuccessAt))
    : null;
  const optionalPage = ["feed", "reports", "corrections"].includes(page);
  const warehouseTypes = NEW_EGG_TYPES;

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

  function openHistory(kind: "production" | "sales", team = false) {
    setHistoryKind(kind);
    setHistoryDates(null);
    setHistoryEmployee("");
    go(team ? "team-records" : "history");
  }

  async function markNotificationRead(id: string) {
    if (notificationPending.current) return;
    notificationPending.current = true;
    setReadingNotification(id);
    setNotificationError("");
    try { await command("notification.read", { id }); }
    catch (cause) { setNotificationError(cause instanceof Error ? cause.message : "Pemberitahuan belum dapat ditandai. Coba lagi."); }
    finally { notificationPending.current = false; setReadingNotification(null); }
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
          <ThemeToggle compact />
          <button
            className={styles.profileButton}
            aria-label="Profil dan pengaturan"
            onClick={() => setProfileOpen(true)}
          >
            <Avatar user={user} size="sm" />
          </button>
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
          {(["skm", "cracked"] as const).map(type => <div key={type} className={type === "cracked" ? styles.crackedPrice : styles.goodPrice}>
            <span><Egg size={17} /> {type === "skm" ? "Telur bagus" : "Telur bentes"}</span>
            <strong>{eggTypePrice(price, type) === undefined ? "Belum ada" : eggTypePrice(price, type) === 0 ? "Gratis" : money(eggTypePrice(price, type)!)}
              {eggTypePrice(price, type) !== undefined && eggTypePrice(price, type)! > 0 && <small>/kg</small>}
            </strong>
            {type === "skm" && <small className={styles.priceSubtypes}>SKM & SKM Baru</small>}
          </div>)}
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
                onClick={() => openSale()}
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
                <small>Stok SKM, SKM Baru, dan Bentes</small>
              </span>
              <ArrowRight size={22} />
            </button>
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
            <InstallApp />
            <PushNotifications />
            <button className={styles.historyLink} onClick={() => openHistory("production")}>
              <History size={22} /><span><strong>Riwayat saya</strong><small>Panen dan penjualan 30 hari terakhir</small></span><ArrowRight size={20} />
            </button>
            {user.can_check_stock && <button className={styles.historyLink} onClick={() => openHistory("production", true)}>
              <ClipboardList size={22} /><span><strong>Catatan seluruh tim</strong><small>Untuk pemeriksaan stok gudang</small></span><ArrowRight size={20} />
            </button>}
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
                  <button onClick={() => setProfileOpen(true)}>
                    <Avatar user={user} size="sm" /> Profil dan pengaturan{" "}
                    <ArrowRight size={17} />
                  </button>
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
              title="Panen hari ini"
              description={state.settings?.harvest_auto_stock !== false ? "Catat hasil telur dari kandang. Panen baru langsung menambah stok gudang." : "Catat hasil telur dari kandang. Setelah disimpan, terima panen di menu Gudang agar stok bertambah."}
            />
            <button
              className={styles.primaryButton}
              onClick={() => setModal("production")}
            >
              <Plus size={23} /> Catat panen baru
            </button>
            <div className={styles.records}>
              {harvestedToday.slice(0, shown).map((row) => (
                <ProductionCard key={row.id} row={row}
                  barnName={state.barns.find(barn => barn.id === row.barn_id)?.name || "Kandang"}
                  onDetail={() => setProductionDetail(row)}
                  onCorrect={() => setCorrection({ entity: "production", record: row })} />
              ))}
            </div>
            {harvestedToday.length === 0 && (
              <EmptyNote
                icon="egg"
                title="Belum ada catatan panen hari ini"
                text="Tekan Catat panen baru untuk mulai."
              />
            )}
            {harvestedToday.length > shown && (
              <MoreRecords onClick={() => setShown(shown + 8)} />
            )}
            <button className={styles.historyLink} onClick={() => openHistory("production")}>
              <History size={22} /><span><strong>Lihat riwayat panen</strong><small>Catatan saya selama 30 hari terakhir</small></span><ArrowRight size={20} />
            </button>
          </>
        )}

        {page === "sales" && (
          <>
            <PageHeading
              title="Penjualan hari ini"
              description={`Penjualan Anda pada ${dateLabel(day)}. Catatan sebelumnya ada di Riwayat.`}
            />
            <button
              className={styles.primaryButton}
              onClick={() => openSale()}
              disabled={!price}
            >
              <Plus size={23} /> Catat penjualan baru
            </button>
            <div className={styles.records}>
              {salesToday.slice(0, shown).map((row) => (
                <SaleCard key={row.id} row={row} onDetail={() => setSaleDetail(row)}
                  onPayment={() => setPaymentSale(row)}
                  onCorrect={() => setCorrection({ entity: "sale", record: row })} />
              ))}
            </div>
            {salesToday.length === 0 && (
              <EmptyNote
                icon="sale"
                title="Belum ada catatan penjualan hari ini"
                text="Setelah menjual telur, catat hasilnya di sini."
              />
            )}
            {salesToday.length > shown && (
              <MoreRecords onClick={() => setShown(shown + 8)} />
            )}
            <button className={styles.historyLink} onClick={() => openHistory("sales")}>
              <History size={22} /><span><strong>Lihat riwayat penjualan</strong><small>Nota saya selama 30 hari terakhir</small></span><ArrowRight size={20} />
            </button>
            <button className={styles.historyLink} onClick={() => go("invoices")}>
              <ReceiptText size={22} /><span><strong>Tagihan saya</strong><small>Pembayaran pelanggan dari semua tanggal</small></span><ArrowRight size={20} />
            </button>
          </>
        )}

        {(page === "history" || page === "team-records") && (
          <>
            <button className={styles.backButton} onClick={() => go(historyKind === "production" ? "production" : "sales")}>
              <ArrowLeft size={20} /> Kembali ke catatan hari ini
            </button>
            <PageHeading title={teamHistory ? "Catatan seluruh tim" : "Riwayat saya"}
              description={teamHistory ? "Panen dan penjualan seluruh tim dalam 30 hari terakhir. Gunakan untuk memeriksa stok gudang." : "Lihat kembali panen, penjualan, dan nota Anda selama 30 hari terakhir."} />
            {page === "team-records" && !user.can_check_stock && <p className={styles.warning}>Akses catatan tim hanya untuk pemeriksa stok. Di bawah ini adalah catatan Anda sendiri.</p>}
            {teamHistory && <p className={styles.scopeNote}>Hanya untuk melihat. Catatan saya di Beranda tetap dihitung dari pekerjaan saya sendiri.</p>}
            <div className={styles.historyTabs} aria-label="Jenis riwayat">
              <button aria-pressed={historyKind === "production"} onClick={() => setHistoryKind("production")}><Egg size={21} /> Panen</button>
              <button aria-pressed={historyKind === "sales"} onClick={() => setHistoryKind("sales")}><ShoppingBag size={21} /> Penjualan</button>
            </div>
            <div className={styles.historyFilters}>
              {teamHistory && <label className={styles.employeeFilter}>Nama petugas
                <select className="form-select" aria-label="Nama petugas" value={historyEmployee} onChange={event => setHistoryEmployee(event.target.value)}>
                  <option value="">Seluruh tim</option>
                  {historyOwners.map(owner => <option value={owner.id} key={owner.id}>{owner.name}{owner.deleted_at ? " (akun dihapus)" : ""}</option>)}
                </select>
              </label>}
              <label>Dari tanggal<input className="form-control" type="date" min={historyWindow.from} max={day} value={historyRange.from}
                onChange={event => setHistoryDates({ ...historyRange, from: event.target.value })} /></label>
              <label>Sampai tanggal<input className="form-control" type="date" min={historyWindow.from} max={day} value={historyRange.to}
                onChange={event => setHistoryDates({ ...historyRange, to: event.target.value })} /></label>
              <button className={styles.textButton} onClick={() => { setHistoryDates(null); setHistoryEmployee(""); }}>Tampilkan 30 hari terakhir</button>
            </div>
            {(!historyRange.from || !historyRange.to || historyRange.from > historyRange.to) ?
              <p className={styles.warning} role="alert">Pilih tanggal awal dan akhir. Tanggal akhir harus sama atau setelah tanggal awal.</p> :
              <p className={styles.rangeLabel}>{dateLabel(historyRange.from)}–{dateLabel(historyRange.to)} · {historyKind === "production" ? historyProductions.length : historySales.length} catatan</p>}
            <div className={styles.records}>
              {historyKind === "production" ? historyProductions.slice(0, shown).map(row => <ProductionCard key={row.id} row={row}
                barnName={state.barns.find(barn => barn.id === row.barn_id)?.name || "Kandang"}
                ownerName={teamHistory ? state.users.find(owner => owner.id === row.user_id)?.name || "Petugas" : undefined}
                onDetail={() => setProductionDetail(row)}
                onCorrect={!teamHistory && row.user_id === user.id ? () => setCorrection({ entity: "production", record: row }) : undefined} />) :
                historySales.slice(0, shown).map(row => <SaleCard key={row.id} row={row}
                  ownerName={teamHistory ? state.users.find(owner => owner.id === row.user_id)?.name || "Petugas" : undefined}
                  onDetail={() => setSaleDetail(row)}
                  onPayment={!teamHistory && row.user_id === user.id ? () => setPaymentSale(row) : undefined}
                  onCorrect={!teamHistory && row.user_id === user.id ? () => setCorrection({ entity: "sale", record: row }) : undefined} />)}
            </div>
            {(historyKind === "production" ? historyProductions.length : historySales.length) === 0 && <EmptyNote
              icon={historyKind === "production" ? "egg" : "sale"} title="Tidak ada catatan pada tanggal ini"
              text="Coba pilih tanggal lain dalam 30 hari terakhir." />}
            {(historyKind === "production" ? historyProductions.length : historySales.length) > shown && <MoreRecords onClick={() => setShown(shown + 8)} />}
            {!teamHistory && historyKind === "sales" && <button className={styles.historyLink} onClick={() => go("invoices")}>
              <ReceiptText size={22} /><span><strong>Tagihan saya</strong><small>Termasuk nota lebih dari 30 hari lalu</small></span><ArrowRight size={20} />
            </button>}
          </>
        )}

        {page === "invoices" && <>
          <button className={styles.backButton} onClick={() => go("sales")}><ArrowLeft size={20} /> Kembali ke penjualan hari ini</button>
          <PageHeading title="Tagihan saya" description="Pantau pembayaran pelanggan dari seluruh penjualan Anda, termasuk nota lama. Pilih tagihan untuk mencatat pembayaran." />
          <InvoiceTasks invoices={state.sales.filter(row => row.user_id === user.id)} />
        </>}

        {page === "stock" && (
          <>
            <PageHeading
              title="Telur di gudang"
              description="Hanya telur yang sudah diterima di gudang yang tersedia untuk diambil dan dijual."
            />
            {user.can_check_stock && <StockChecks />}
            {user.can_check_stock && <button className={styles.historyLink} onClick={() => openHistory("production", true)}>
              <ClipboardList size={22} /><span><strong>Lihat catatan seluruh tim</strong><small>Bandingkan panen dan penjualan</small></span><ArrowRight size={20} />
            </button>}
            <PendingHarvest />
            <div className={styles.stockCards}>
              {warehouseTypes.map(type => {
                const label = categoryLabel(type), stock = eggStock(state, type), good = type !== "cracked";
                return (
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
              ); })}
            </div>
            <div className={styles.stockActions}>
              <button
                className={styles.primaryButton}
                onClick={() => openSale({ source: "warehouse" })}
              >
                <ShoppingBag size={22} /> Jual dari gudang
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => setModal("pickup")}
              >
                <Package size={22} /> Ambil telur untuk dijual
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => setModal("production")}
              >
                <Plus size={20} /> Catat panen dari kandang
              </button>
            </div>
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <h2>Telur yang saya bawa</h2>
                <span>{carried.length} pengambilan</span>
              </div>
              {carried.length === 0 && (
                <EmptyNote
                  icon="stock"
                  title="Tidak ada telur yang dibawa"
                  text="Telur yang Anda ambil untuk dibawa akan muncul di sini."
                />
              )}
              <div className={styles.records}>
                {carried.map(({ pickup, balance }) => (
                  <article className={styles.record} key={pickup.id}>
                    <div className={styles.recordTop}>
                      <span
                        className={
                          pickup.category !== "cracked"
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
                        onClick={() => openSale({ source: "pickup", pickupId: pickup.id })}
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

      {profileOpen && <ProfileSettings onClose={() => setProfileOpen(false)} />}
      {modal && (
        <EntryModal
          key={modal}
          kind={modal}
          saleStart={saleStart}
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
      {saleDetail && (saleDetail.user_id === user.id || user.can_check_stock) && (
        <SaleDetail
          sale={
            state.sales.find((row) => row.id === saleDetail.id) || saleDetail
          }
          onClose={() => setSaleDetail(null)}
        />
      )}
      {productionDetail && (productionDetail.user_id === user.id || user.can_check_stock) && <Dialog title="Rincian panen" onClose={() => setProductionDetail(null)}>
        <div className="modal-body-custom">
          <ProductionCard row={state.productions.find(row => row.id === productionDetail.id) || productionDetail}
            barnName={state.barns.find(barn => barn.id === productionDetail.barn_id)?.name || "Kandang"}
            ownerName={state.users.find(owner => owner.id === productionDetail.user_id)?.name || "Petugas"} expanded />
        </div>
      </Dialog>}
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
          onClose={() => setNotificationsOpen(false)}
        >
          <div className={styles.notifications}>
            {notificationError && <p className={styles.warning} role="alert">{notificationError}</p>}
            <div className={styles.notificationActions}>
              <p aria-live="polite">{unread > 0 ? `${unread} pemberitahuan belum dibaca` : "Semua pemberitahuan sudah dibaca"}</p>
              <button className={styles.secondaryButton} disabled={unread === 0 || readingNotification !== null}
                onClick={() => void markNotificationRead("all")}>
                <Check size={20} /> {readingNotification === "all" ? "Menandai pemberitahuan…" : "Tandai sudah dibaca semua"}
              </button>
            </div>
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
                    disabled={readingNotification !== null}
                    onClick={() => void markNotificationRead(row.id)}
                  >
                    <Check size={18} /> {readingNotification === row.id ? "Menandai…" : "Sudah dibaca"}
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

function ProductionCard({ row, barnName, ownerName, onDetail, onCorrect, expanded = false }: {
  row: Production; barnName: string; ownerName?: string; onDetail?: () => void; onCorrect?: () => void; expanded?: boolean;
}) {
  return <article className={styles.record}>
    <div className={styles.recordTop}>
      <span className={row.category !== "cracked" ? styles.goodBadge : styles.crackedBadge}>{categoryLabel(row.category)}</span>
      <small>{dateLabel(row.date, row.date.length > 10)}{row.date.length > 10 ? " WIB" : ""}</small>
    </div>
    {ownerName && <p className={styles.recordOwner}>Dicatat oleh <strong>{ownerName}</strong></p>}
    <div className={styles.recordQuantity}><strong>{quantity(row.kg)} <small>kg</small></strong><span>{number(row.eggs)} butir · {quantity(row.trays)} krat</span></div>
    <p>{barnName}</p>
    <p className={isProductionStocked(row) ? "text-success" : "text-warning"}>{isProductionStocked(row) ? "Sudah masuk gudang" : "Belum masuk gudang"}</p>
    {expanded && <>
      <p>Waktu input: {dateLabel(row.created_at, true)} WIB</p>
      {row.stocked_at && <p>Masuk gudang: {dateLabel(row.stocked_at, true)} WIB</p>}
      {row.notes && <p className={styles.notes}>{row.notes}</p>}
      {(row.photo || row.photo_ref) && <ImagePreview src={row.photo} photoRef={row.photo_ref} alt="Foto panen" />}
    </>}
    {onDetail && <div className={styles.recordButtons}><button className={styles.secondaryButton} onClick={onDetail}><ClipboardList size={19} /> Lihat rincian panen</button></div>}
    {onCorrect && <button className={styles.textButton} onClick={onCorrect}><Pencil size={17} /> {row.locked ? "Ajukan perbaikan" : "Perbaiki catatan"}</button>}
  </article>;
}

function SaleCard({ row, ownerName, onDetail, onPayment, onCorrect }: {
  row: Sale; ownerName?: string; onDetail: () => void; onPayment?: () => void; onCorrect?: () => void;
}) {
  return <article className={styles.record}>
    <div className={styles.recordTop}>
      <span className={row.balance === 0 ? styles.goodBadge : styles.crackedBadge}>{row.balance === 0 ? "Lunas" : row.paid > 0 ? "Dibayar sebagian" : "Belum lunas"}</span>
      <small>{dateLabel(row.date, row.date.length > 10)}{row.date.length > 10 ? " WIB" : ""}</small>
    </div>
    {ownerName && <p className={styles.recordOwner}>Dicatat oleh <strong>{ownerName}</strong></p>}
    <h2 className={styles.saleTotal}>{row.total === 0 ? "Gratis" : money(row.total)}</h2>
    <p>{row.customer || "Pelanggan umum"}</p>
    <div className={styles.saleItems}>{row.items.map(item => <span key={item.id}>{categoryLabel(item.category)} · {quantity(item.kg)} kg{item.category === "cracked" && item.unit_price === 0 && " · Gratis"}</span>)}</div>
    {row.balance > 0 && <p className={styles.balance}>Belum dibayar: <strong>{money(row.balance)}</strong></p>}
    <div className={styles.recordButtons}>
      <button className={styles.secondaryButton} onClick={onDetail}><ReceiptText size={18} /> Lihat nota</button>
      {row.balance > 0 && onPayment && <button className={styles.secondaryButton} onClick={onPayment}>Catat pembayaran</button>}
    </div>
    {onCorrect && <button className={styles.textButton} onClick={onCorrect}><Pencil size={17} /> Ajukan perbaikan</button>}
  </article>;
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
      Lihat catatan lainnya <ChevronDown size={18} />
    </button>
  );
}
