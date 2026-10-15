"use client";
import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Egg,
  Leaf,
  MoreHorizontal,
  Package,
  Plus,
  ShoppingBag,
  Sprout,
  TrendingUp,
  Users,
  Wallet,
  Wheat,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  activePrice,
  businessDate,
  dateLabel,
  eggStock,
  feedStock,
  money,
  number,
  today,
} from "@/lib/domain";
import { useFarm } from "@/lib/store";
import { FarmArt } from "./App";
import { printReceipt } from "@/lib/export";

export default function Dashboard({
  go,
  open,
}: {
  go: (page: string) => void;
  open: (kind: string) => void;
}) {
  const { state, user } = useFarm();
  const [period, setPeriod] = useState(7);
  const [chart, setChart] = useState("production");
  const [quick, setQuick] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const day = today();
  const series = useMemo(() => {
    if (!state) return [];
    return Array.from({ length: period }, (_, i) => {
      const d = new Date(day + "T12:00:00+07:00");
      d.setDate(d.getDate() - (period - 1 - i));
      const dt = d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
      const p = state.productions.filter((x) => businessDate(x.date) === dt);
      const s = state.sales.filter((x) => businessDate(x.date) === dt);
      return {
        date: dt,
        label: d.toLocaleDateString("id-ID", {
          day: "2-digit",
          month: "short",
          timeZone: "Asia/Jakarta",
        }),
        production: p.reduce((a, x) => a + x.kg, 0),
        sales: s.reduce((a, x) => a + x.items.reduce((b, y) => b + y.kg, 0), 0),
        omzet: s.reduce((a, x) => a + x.total, 0),
      };
    });
  }, [state, period, day]);
  if (!state || !user) return null;
  const price = activePrice(state);
  const stock = eggStock(state);
  const good = eggStock(state, "good"),
    cracked = eggStock(state, "cracked");
  const dailyProduction = state.productions.filter(
    (p) => businessDate(p.date) === day,
  );
  const dailySales = state.sales.filter((s) => businessDate(s.date) === day);
  const production = dailyProduction.reduce((a, x) => a + x.kg, 0);
  const eggs = dailyProduction.reduce((a, x) => a + x.eggs, 0);
  const revenue = dailySales.reduce((a, x) => a + x.total, 0);
  const sold = dailySales.reduce(
    (a, x) => a + x.items.reduce((b, y) => b + y.kg, 0),
    0,
  );
  const employees = state.users.filter(
    (x) => x.role === "employee" && x.active,
  );
  const rangeStart = series[0]?.date || day;
  const rank = employees
    .map((u) => ({
      ...u,
      total: state.sales
        .filter(
          (s) =>
            s.user_id === u.id &&
            businessDate(s.date) >= rangeStart &&
            businessDate(s.date) <= day,
        )
        .reduce((a, x) => a + x.total, 0),
    }))
    .sort((a, b) => b.total - a.total);
  const feeds = state.feeds.map((f) => ({
    ...f,
    stock: feedStock(state, f.id),
  }));
  const sumSeries = (key: "production" | "sales" | "omzet") =>
    series.reduce((a, x) => a + x[key], 0);
  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow">DARI PETERNAKAN, UNTUK MASA DEPAN</div>
          <h1>
            Ringkasan peternakan<span className="heading-dot">.</span>
          </h1>
          <p>
            Selamat datang, {user.name.split(" ")[0]}{" "}
            <span className="wave">☀</span> Mari lihat perkembangan usaha Anda
            hari ini.
          </p>
        </div>
        <div className="heading-actions">
          <button className="btn btn-white" onClick={() => go("reports")}>
            <ArrowDownToLine size={16} />
            Unduh laporan
          </button>
          <div className="quick-wrap">
            <button
              className="btn btn-primary"
              onClick={() => setQuick(!quick)}
            >
              <Plus size={18} />
              Catat aktivitas
              <ChevronDown size={15} />
            </button>
            {quick && (
              <div className="quick-menu">
                {[
                  ["production", "Produksi telur", Egg],
                  ["pickup", "Pengambilan telur", Package],
                  ["sale", "Penjualan telur", ShoppingBag],
                  ["feed.use", "Pemakaian pakan", Wheat],
                ].map(([id, label, Icon]) => {
                  const I = Icon as typeof Egg;
                  return (
                    <button
                      key={String(id)}
                      onClick={() => {
                        open(String(id));
                        setQuick(false);
                      }}
                    >
                      <I size={17} />
                      {String(label)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="welcome-grid">
        <section className="welcome-banner">
          <div>
            <span className="banner-kicker">
              <span /> CATAT HARI INI, TUMBUH ESOK HARI
            </span>
            <h2>
              Peternakan terkelola.
              <br />
              Pikiran lebih tenang.
            </h2>
            <p>Semua aktivitas usaha, dalam satu tempat.</p>
            <button onClick={() => open("production")}>
              Catat panen hari ini <ArrowUpRight size={17} />
            </button>
          </div>
          <FarmArt />
          <span className="banner-leaf">
            <Leaf size={130} />
          </span>
        </section>
        <section className="price-panel">
          <div className="price-panel-top">
            <span className="icon-box green">
              <Wallet size={20} />
            </span>
            <div>
              <h3>Harga telur hari ini</h3>
              <span>
                {price ? "Harga aktif per kilogram" : "Harga belum ditetapkan"}
              </span>
            </div>
            <span className="live-tag">
              <span />
              Live
            </span>
          </div>
          <div className="price-values">
            <div>
              <span>
                <i className="dot green-dot" />
                Telur bagus
              </span>
              <strong>
                {price ? money(price.good_price) : "—"}
                <small>/kg</small>
              </strong>
            </div>
            <div>
              <span>
                <i className="dot amber-dot" />
                Telur bentes
              </span>
              <strong>
                {price ? price.cracked_price === 0 ? "Gratis" : money(price.cracked_price) : "—"}
                {price && price.cracked_price > 0 && <small>/kg</small>}
              </strong>
            </div>
          </div>
          <button className="price-footer" onClick={() => go("prices")}>
            <span>
              <HistoryIcon />
              {price
                ? `Berlaku ${dateLabel(price.effective_at)}`
                : "Atur harga sebelum mulai menjual"}
            </span>
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <div className="section-bar">
        <h3>{user.role === "admin" ? "Hari ini di peternakan" : "Aktivitas Anda hari ini"}</h3>
        <span>
          <CalendarDays size={15} />
          {dateLabel(day)}
        </span>
      </div>
      <div className="summary-grid">
        <Metric
          title="Produksi telur"
          value={number(production)}
          unit="kg"
          icon={<Egg size={22} />}
          color="green"
          detail={`${number(eggs, 0)} butir telur terkumpul`}
          foot={`${dailyProduction.length} pencatatan panen`}
          onClick={() => go("production")}
        />
        <Metric
          title="Omzet penjualan"
          value={money(revenue)}
          icon={<Wallet size={21} />}
          color="amber"
          detail={`${dailySales.length} transaksi penjualan`}
          foot={`${number(sold)} kg terjual hari ini`}
          onClick={() => go("sales")}
        />
        <Metric
          title="Stok telur tersedia"
          value={number(stock.kg)}
          unit="kg"
          icon={<Package size={21} />}
          color="blue"
          detail={`${number(stock.eggs, 0)} butir di gudang`}
          foot="Siap diambil untuk penjualan"
          onClick={() => go("stock")}
        />
        <Metric
          title={user.role === "admin" ? "Karyawan aktif" : "Target bulanan Anda"}
          value={user.role === "admin" ? number(employees.length, 0) : money(user.target)}
          unit={user.role === "admin" ? "orang" : undefined}
          icon={<Users size={21} />}
          color="purple"
          detail={user.role === "admin" ? "Bersama mengembangkan usaha" : "Pantau pencapaian pada laporan"}
          foot={
            user.role === "admin"
              ? "Lihat performa tim Anda"
              : "Lihat hasil penjualan Anda"
          }
          onClick={() => go(user.role === "admin" ? "employees" : "reports")}
        />
      </div>
      <div className="charts-grid">
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h3>Perkembangan usaha</h3>
              <p>Hasil kerja yang terus bertumbuh</p>
            </div>
            <select
              className="form-select period-select"
              aria-label="Periode grafik"
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
            >
              <option value={7}>7 hari terakhir</option>
              <option value={14}>14 hari terakhir</option>
              <option value={30}>30 hari terakhir</option>
            </select>
          </div>
          <div className="chart-tabs">
            <button
              className={chart === "production" ? "active" : ""}
              onClick={() => setChart("production")}
            >
              Produksi & penjualan
            </button>
            <button
              className={chart === "omzet" ? "active" : ""}
              onClick={() => setChart("omzet")}
            >
              Omzet
            </button>
          </div>
          <div className="chart-summary">
            <div>
              <span>
                {chart === "omzet" ? "Total omzet" : "Total produksi"}
              </span>
              <strong>
                {chart === "omzet" ? (
                  money(sumSeries("omzet"))
                ) : (
                  <>
                    {number(sumSeries("production"))}
                    <small>kg</small>
                  </>
                )}
              </strong>
            </div>
            {chart !== "omzet" && (
              <div>
                <span>Total terjual</span>
                <strong>
                  {number(sumSeries("sales"))}
                  <small>kg</small>
                </strong>
              </div>
            )}
            <div className="chart-legend">
              <span>
                <i className="dot green-dot" />
                {chart === "omzet" ? "Omzet" : "Produksi"}
              </span>
              {chart !== "omzet" && (
                <span>
                  <i className="dot light-green-dot" />
                  Penjualan
                </span>
              )}
            </div>
          </div>
          <div className="chart-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={series}
                margin={{ top: 12, right: 12, left: -22, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="productionGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#287951" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#287951" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 5"
                  vertical={false}
                  stroke="#e8ece7"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#8b948d" }}
                  minTickGap={30}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#8b948d" }}
                  tickFormatter={(v) =>
                    chart === "omzet" ? `${number(v / 1000000)}jt` : String(v)
                  }
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e6eae3",
                    fontSize: 11,
                  }}
                  formatter={(v, n) => [
                    chart === "omzet"
                      ? money(Number(v))
                      : `${number(Number(v))} kg`,
                    n === "production"
                      ? "Produksi"
                      : n === "sales"
                        ? "Penjualan"
                        : "Omzet",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey={chart === "omzet" ? "omzet" : "production"}
                  stroke="#337d50"
                  fill="url(#productionGradient)"
                  strokeWidth={2.5}
                  activeDot={{ r: 5 }}
                />
                {chart !== "omzet" && (
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="#acc57b"
                    strokeWidth={2.5}
                    fill="transparent"
                    strokeDasharray="5 4"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-caption">
            <Sprout size={14} />
            Setiap catatan membantu Anda mengambil keputusan lebih baik.
          </div>
        </section>
        <section className="panel stock-panel">
          <div className="panel-header">
            <div>
              <h3>Komposisi stok</h3>
              <p>Persediaan telur di gudang</p>
            </div>
            <button
              className="icon-button"
              aria-label="Lihat stok"
              onClick={() => go("stock")}
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
          <div className="stock-donut-wrap">
            <div
              className="stock-donut"
              style={{
                background: stock.kg
                  ? `conic-gradient(#377a50 0% ${(good.kg / stock.kg) * 100}%, #e9ce91 ${(good.kg / stock.kg) * 100}% 100%)`
                  : "#edf0e9",
              }}
            >
              <div>
                <span>Total stok</span>
                <strong>{number(stock.kg)}</strong>
                <small>kilogram</small>
              </div>
            </div>
            <span className="donut-leaf">
              <Leaf size={19} />
            </span>
          </div>
          <div className="stock-breakdown">
            <div>
              <span className="stock-category">
                <span className="dot green-dot" />
                Telur bagus
              </span>
              <strong>
                {number(good.kg)} <small>kg</small>
              </strong>
              <span className="stock-percent">
                {stock.kg ? Math.round((good.kg / stock.kg) * 100) : 0}%
              </span>
            </div>
            <div>
              <span className="stock-category">
                <span className="dot amber-dot" />
                Telur bentes
              </span>
              <strong>
                {number(cracked.kg)} <small>kg</small>
              </strong>
              <span className="stock-percent">
                {stock.kg ? Math.round((cracked.kg / stock.kg) * 100) : 0}%
              </span>
            </div>
          </div>
          <button className="btn btn-soft w-100" onClick={() => go("stock")}>
            Lihat pergerakan stok
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <div className="bottom-grid">
        <section className="panel latest-sales">
          <div className="panel-header">
            <div>
              <h3>Penjualan terbaru</h3>
              <p>Setiap transaksi, tercatat dengan baik</p>
            </div>
            <button className="text-button" onClick={() => go("sales")}>
              Lihat semua
              <ArrowRight size={14} />
            </button>
          </div>
          {downloadError && (
            <div className="alert alert-danger mx-3">{downloadError}</div>
          )}
          <div className="table-responsive">
            <table className="table farm-table">
              <thead>
                <tr>
                  <th>TRANSAKSI</th>
                  <th>KARYAWAN</th>
                  <th>JUMLAH</th>
                  <th>TOTAL</th>
                  <th>STATUS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...state.sales]
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .slice(0, 5)
                  .map((s) => {
                    const u = state.users.find((u) => u.id === s.user_id);
                    return (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.number}</strong>
                          <small>{s.customer || "Pelanggan umum"}</small>
                        </td>
                        <td>
                          <span className="table-person">
                            <span className="mini-avatar">
                              {u?.name[0] || "K"}
                            </span>
                            {u?.name.split(" ")[0] || "Karyawan"}
                          </span>
                        </td>
                        <td>
                          {number(s.items.reduce((a, i) => a + i.kg, 0))} kg
                        </td>
                        <td className="fw-semibold">{money(s.total)}</td>
                        <td>
                          <span
                            className={`status-pill ${s.payment_status === "paid" ? "success" : s.payment_status === "partial" ? "warning" : "neutral"}`}
                          >
                            {s.payment_status === "paid" ? (
                              <Check size={11} />
                            ) : null}
                            {s.payment_status === "paid"
                              ? "Lunas"
                              : s.payment_status === "partial"
                                ? "Sebagian"
                                : "Piutang"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Unduh nota ${s.number}`}
                            onClick={() =>
                              printReceipt(s, state).catch((e) =>
                                setDownloadError(e.message),
                              )
                            }
                          >
                            <ArrowDownToLine size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                {state.sales.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">
                        Belum ada transaksi. Mulai catat penjualan pertama Anda.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel leaderboard">
          <div className="panel-header">
            <div>
              <h3>
                {user.role === "admin"
                  ? "Tim paling produktif"
                  : "Penjualan Anda"}
              </h3>
              <p>Omzet {period} hari terakhir</p>
            </div>
            <span className="icon-box amber small-icon">
              <TrendingUp size={18} />
            </span>
          </div>
          {rank.slice(0, 3).map((u, i) => (
            <div className="ranking-row" key={u.id}>
              <span className={`rank-number rank-${i}`}>{i + 1}</span>
              <span className={`avatar team-${i}`}>
                {u.name
                  .split(" ")
                  .map((x) => x[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{u.name}</strong>
                <div className="rank-bar">
                  <span
                    style={{
                      width: `${rank[0]?.total ? (u.total / rank[0].total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <strong className="rank-total">{money(u.total)}</strong>
            </div>
          ))}
          {rank.length === 0 && (
            <div className="empty-state">Belum ada data karyawan.</div>
          )}
          <button className="leaderboard-footer" onClick={() => go("reports")}>
            Lihat performa penjualan
            <ArrowRight size={14} />
          </button>
        </section>
      </div>
      {feeds.length > 0 && (
        <section className="feed-strip">
          <span className="icon-box amber">
            <Wheat size={22} />
          </span>
          <div>
            <strong>Persediaan pakan, tetap terpantau.</strong>
            <p>
              {feeds.filter((f) => f.stock <= f.min_stock).length > 0
                ? `${feeds.filter((f) => f.stock <= f.min_stock).length} jenis pakan mencapai batas minimum. Siapkan pembelian berikutnya.`
                : `${feeds.length} jenis pakan tersedia. Catat pemakaian agar stok tetap akurat.`}
            </p>
          </div>
          <button className="btn btn-white" onClick={() => go("feed")}>
            Kelola pakan
            <ArrowRight size={15} />
          </button>
        </section>
      )}
    </>
  );
}
function HistoryIcon() {
  return <CalendarDays size={13} />;
}
function Metric({
  title,
  value,
  unit,
  icon,
  color,
  detail,
  foot,
  onClick,
}: {
  title: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  color: string;
  detail: string;
  foot: string;
  onClick: () => void;
}) {
  return (
    <button className="summary-card" onClick={onClick}>
      <div className="summary-top">
        <span>{title}</span>
        <span className={`icon-box ${color}`}>{icon}</span>
      </div>
      <div className="summary-value">
        {value}
        <small>{unit}</small>
      </div>
      <p>{detail}</p>
      <div className="summary-footer">
        <span className="tiny-dot" />
        {foot}
        <ArrowUpRight size={14} />
      </div>
    </button>
  );
}
