"use client";
import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  BarChart3,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFarm } from "@/lib/store";
import { saleSourceLabel } from "@/lib/sale-availability";
import {
  businessDate,
  closingEggStock,
  dateLabel,
  eggStock,
  isFreeSaleItem,
  money,
  number,
  today,
} from "@/lib/domain";
import {
  exportExcel,
  exportReportPDF,
  formatReportCell,
  REPORT_TIME_NOTE,
  type ReportTable,
} from "@/lib/export";
import { adjustmentMethodLabel, categoryLabel, methodLabel } from "./ModuleUI";
import { inReportRange, reportRange, reportRangeError, type ReportPreset } from "@/lib/report-range";
import { ALL_EGG_TYPES, eggTypeLabel } from "@/lib/egg-types";
import { eggSummaryRows, saleInvoiceTotals, summarizeEggTypes } from "@/lib/egg-report";
import styles from "./Reports.module.css";

export default function Reports() {
  const { state, user } = useFarm();
  const [preset, setPreset] = useState<ReportPreset>("today");
  const [custom, setCustom] = useState(() => reportRange("today"));
  const range = preset === "custom" ? custom : reportRange(preset);
  const { from, to } = range;
  const rangeError = reportRangeError(range);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const inRange = (date: string) => !rangeError && inReportRange(date, range);
  const sales = state.sales.filter((s) => inRange(s.date));
  const production = state.productions.filter((p) => inRange(p.date));
  const purchases = state.feed_purchases.filter((p) => inRange(p.date));
  const usages = state.feed_usages.filter((p) => inRange(p.date));
  const saleItems = sales.flatMap(sale => sale.items);
  const harvestSummary = summarizeEggTypes(production);
  const saleSummary = summarizeEggTypes(saleItems);
  const summaryTypes = ALL_EGG_TYPES.filter(type => type !== "good" || harvestSummary.hasLegacy || saleSummary.hasLegacy);
  const currentStockTypes = ALL_EGG_TYPES.filter(type => {
    const q = eggStock(state, type);
    return type !== "good" || q.eggs !== 0 || q.kg !== 0 || q.trays !== 0;
  });
  const closingStockRows = ALL_EGG_TYPES.map(type => ({ type, stock: closingEggStock(state, type, to) }))
    .filter(({ type, stock }) => type !== "good" || !stock || stock.eggs !== 0 || stock.kg !== 0);
  const employee = (id: string) =>
    state.users.find((u) => u.id === id)?.name || "Karyawan";
  const tables: ReportTable[] = [
    {
      name: "Penjualan",
      columns: [
        "Nomor",
        "Tanggal & jam (WIB)",
        "Waktu input (WIB)",
        "Karyawan",
        "Pelanggan",
        "Sumber telur",
        "Berat (kg)",
        "Gratis (kg)",
        "Omzet (Rp)",
        "Dibayar (Rp)",
        "Piutang (Rp)",
        "Pembayaran",
      ],
      rows: sales.map((s) => [
        s.number,
        s.date,
        s.created_at,
        employee(s.user_id),
        s.customer || "Umum",
        saleSourceLabel(s.stock_source),
        s.items.reduce((a, i) => a + i.kg, 0),
        s.items.filter(isFreeSaleItem).reduce((a, i) => a + i.kg, 0),
        s.total,
        s.paid,
        s.balance,
        s.total === 0 ? "Gratis" : methodLabel(s.payment_method),
      ]),
    },
    {
      name: "Penjualan per jenis",
      columns: ["Jenis telur", "Butir", "Berat (kg)", "Krat", "Omzet (Rp)"],
      rows: eggSummaryRows(saleItems, true),
    },
    {
      name: "Rincian item penjualan",
      columns: ["Nomor nota", "Tanggal & jam (WIB)", "Karyawan", "Pelanggan", "Jenis telur", "Butir", "Berat (kg)", "Krat", "Harga transaksi (Rp/kg)", "Nilai item (Rp)"],
      rows: sales.flatMap(sale => sale.items.map(item => [sale.number, sale.date, employee(sale.user_id), sale.customer || "Umum", eggTypeLabel(item.category), item.eggs, item.kg, item.trays, item.unit_price, item.total])),
    },
    {
      name: "Produksi",
      columns: [
        "Tanggal panen",
        "Waktu input (WIB)",
        "Karyawan",
        "Kandang",
        "Jenis telur",
        "Butir",
        "Berat (kg)",
        "Krat",
        "Catatan",
      ],
      rows: production.map((p) => [
        p.date,
        p.created_at,
        employee(p.user_id),
        state.barns.find((b) => b.id === p.barn_id)?.name || "-",
        categoryLabel(p.category),
        p.eggs,
        p.kg,
        p.trays,
        p.notes,
      ]),
    },
    {
      name: "Panen per jenis",
      columns: ["Jenis telur", "Butir", "Berat (kg)", "Krat"],
      rows: eggSummaryRows(production),
    },
    {
      name: "Performa karyawan",
      columns: [
        "Karyawan",
        "Transaksi",
        "Berat terjual (kg)",
        "Omzet (Rp)",
        "Target (Rp)",
        "Pencapaian (%)",
      ],
      rows: state.users
        .filter(
          (u) => u.role === "employee" || sales.some((s) => s.user_id === u.id),
        )
        .map((u) => {
          const own = sales.filter((s) => s.user_id === u.id);
          const total = own.reduce((a, s) => a + s.total, 0);
          return [
            u.name,
            own.length,
            own.reduce((a, s) => a + s.items.reduce((b, i) => b + i.kg, 0), 0),
            total,
            u.target,
            u.target ? Math.round((total / u.target) * 100) : 0,
          ];
        })
        .sort((a, b) => Number(b[3]) - Number(a[3])),
    },
    ...(user?.role === "admin"
      ? [
          {
            name: "Pembelian pakan",
            columns: [
              "Nomor",
              "Tanggal & jam (WIB)",
              "Waktu input (WIB)",
              "Pemasok",
              "Total (Rp)",
              "Dibayar (Rp)",
              "Sisa (Rp)",
            ],
            rows: purchases.map((p) => [
              p.number,
              p.date,
              p.created_at,
              p.supplier,
              p.total,
              p.paid,
              p.balance,
            ]),
          },
        ]
      : []),
    {
      name: "Pemakaian pakan",
      columns: [
        "Tanggal pemakaian",
        "Waktu input (WIB)",
        "Karyawan",
        "Pakan",
        "Kandang",
        "Jumlah (kg)",
        "Catatan",
      ],
      rows: usages.map((u) => [
        u.date,
        u.created_at,
        employee(u.user_id),
        state.feeds.find((f) => f.id === u.feed_id)?.name || "-",
        state.barns.find((b) => b.id === u.barn_id)?.name || "-",
        u.quantity,
        u.notes,
      ]),
    },
    {
      name: "Mutasi stok",
      columns: [
        "Tanggal & jam (WIB)",
        "Waktu input (WIB)",
        "Pencatat",
        "Kategori",
        "Pergerakan",
        "Butir (+/-)",
        "Berat kg (+/-)",
        "Krat (+/-)",
        "Catatan",
      ],
      rows: (state.stock_movements || [])
        .filter((m) => inRange(m.date))
        .map((m) => [
          m.date,
          m.created_at,
          employee(m.user_id),
          categoryLabel(m.category),
          {
            production: "Produksi",
            pickup: "Pengambilan",
            return: "Pengembalian",
            sale: "Penjualan dari gudang",
            correction: "Koreksi",
            reconcile: adjustmentMethodLabel(m.method),
            classify_in: "Pemilahan masuk",
            classify_out: "Pemilahan keluar",
          }[m.kind],
          m.eggs,
          m.kg,
          m.trays,
          m.notes,
        ]),
    },
    ...(user?.role === "admin" ? [{
      name: "Saldo akhir gudang",
      columns: ["Tanggal saldo", "Kategori", "Butir", "Berat (kg)", "Keterangan"],
      rows: closingStockRows.map(({ type, stock }) => {
        return [to, categoryLabel(type), stock?.eggs ?? "—", stock?.kg ?? "—",
          !stock ? "Riwayat stok pada tanggal ini belum lengkap." : to === today() ? "Saldo berjalan hari ini (WIB)" : "Saldo pada akhir hari (WIB)"];
      }),
    }, {
      name: "Penyesuaian gudang",
      columns: [
        "Tanggal & jam (WIB)", "Admin", "Kategori", "Jenis penyesuaian",
        "Butir awal", "Selisih butir", "Butir akhir",
        "Kg awal", "Selisih kg", "Kg akhir",
        "Krat awal", "Selisih krat", "Krat akhir", "Alasan",
      ],
      rows: (state.stock_movements ?? [])
        .filter(m => m.kind === "reconcile" && inRange(m.date))
        .map(m => [
          m.created_at, employee(m.user_id), categoryLabel(m.category), adjustmentMethodLabel(m.method),
          m.expected?.eggs ?? "—", m.eggs, m.physical?.eggs ?? "—",
          m.expected?.kg ?? "—", m.kg, m.physical?.kg ?? "—",
          m.expected?.trays ?? "—", m.physical?.trays === undefined ? "—" : m.trays, m.physical?.trays ?? "—",
          m.notes,
        ]),
    }] : [{
      name: "Stok saat ini",
      columns: ["Waktu pencatatan WIB", "Kategori", "Butir", "Berat (kg)"],
      rows: currentStockTypes.map(c => {
        const stock = eggStock(state, c);
        return [new Date().toISOString(), categoryLabel(c), stock.eggs, stock.kg];
      }),
    }]),
  ];
  const selected = tables[Math.min(tab, tables.length - 1)];
  const chart = useMemo(() => {
    const grouped = new Map<string, number>();
    state.sales
      .filter((s) => !rangeError && inReportRange(s.date, { from, to }))
      .forEach((s) =>
        grouped.set(
          businessDate(s.date),
          (grouped.get(businessDate(s.date)) || 0) + s.total,
        ),
      );
    return [...grouped]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, omzet]) => ({ date: dateLabel(date), omzet }));
  }, [state.sales, from, to, rangeError]);
  const { total, balance } = saleInvoiceTotals(sales);
  const invalid = !!rangeError;
  async function download(format: string) {
    setBusy(format);
    setError("");
    try {
      if (rangeError) throw new Error(rangeError);
      const file = `TernaKu-laporan-${from}-${to}`;
      if (format === "excel") await exportExcel(tables, file);
      else
        await exportReportPDF(
          tables,
          `${dateLabel(from)} - ${dateLabel(to)}`,
          file,
        );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CATATAN MENJADI WAWASAN</div>
          <h1>
            Laporan usaha<span className="heading-dot">.</span>
          </h1>
          <p>Pilih periode untuk melihat penjualan, panen, dan biaya peternakan.</p>
        </div>
        <span className="icon-box green">
          <BarChart3 size={23} />
        </span>
      </div>
      <section className={`panel report-filters ${styles.filters}`}>
        <div className={styles.presets} role="group" aria-label="Periode laporan">
          {([
            ["today", "Hari ini"], ["yesterday", "Kemarin"], ["7days", "7 hari"],
            ["30days", "30 hari"], ["custom", "Custom"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn ${preset === value ? "btn-primary" : "btn-white"}`}
              aria-pressed={preset === value}
              onClick={() => {
                if (value === "custom") setCustom({ from, to });
                setPreset(value);
                setError("");
              }}
            >{label}</button>
          ))}
        </div>
        <p className={styles.periodNote}>
          {preset === "custom" ? "Tentukan sendiri tanggal mulai dan akhir." : "Periode mengikuti tanggal WIB. Pilihan 7 dan 30 hari termasuk hari ini."}
        </p>
        <div className="form-field">
          <label htmlFor="report-from">Tanggal mulai</label>
          <input
            id="report-from"
            type="date"
            className="form-control"
            value={from}
            max={to || undefined}
            onChange={(e) => { setCustom({ from: e.target.value, to }); setPreset("custom"); setError(""); }}
          />
        </div>
        <div className="form-field">
          <label htmlFor="report-to">Tanggal akhir</label>
          <input
            id="report-to"
            type="date"
            className="form-control"
            value={to}
            min={from || undefined}
            max={today()}
            onChange={(e) => { setCustom({ from, to: e.target.value }); setPreset("custom"); setError(""); }}
          />
        </div>
        <button
          className="btn btn-white"
          disabled={!!busy || invalid}
          onClick={() => download("pdf")}
        >
          {busy === "pdf" ? <LoaderCircle size={16} /> : <FileText size={16} />}
          Unduh PDF
        </button>
        <button
          className="btn btn-primary"
          disabled={!!busy || invalid}
          onClick={() => download("excel")}
        >
          {busy === "excel" ? (
            <LoaderCircle size={16} />
          ) : (
            <FileSpreadsheet size={16} />
          )}
          Unduh Excel
        </button>
      </section>
      {(error || invalid) && (
        <div role="alert" className="alert alert-danger">
          {error || rangeError}
        </div>
      )}
      <p className="report-caption">
        Menampilkan {dateLabel(from)} – {dateLabel(to)} ·{" "}
        {user?.role === "admin" ? "Seluruh peternakan" : user?.can_check_stock ? "Data yang dapat Anda lihat" : "Data milik Anda"} ·
        Target dibandingkan dengan omzet pada periode yang dipilih.
      </p>
      <p className="report-caption">{REPORT_TIME_NOTE}</p>
      <p className="report-caption">Subtotal bagus hanya menjumlahkan SKM dan SKM Baru. Telur bagus lama yang belum dibedakan tetap ditampilkan terpisah. Pembayaran dan piutang dihitung sekali per nota.</p>
      <div className="report-stats">
        <div className="metric-card">
          <p>Omzet penjualan</p>
          <strong>{money(total)}</strong>
          <small>{sales.length} transaksi</small>
        </div>
        <div className="metric-card">
          <p>Produksi telur</p>
          <strong>
            {number(production.reduce((a, p) => a + p.kg, 0))} <small>kg</small>
          </strong>
          <small>
            {number(
              production.reduce((a, p) => a + p.eggs, 0),
              0,
            )}{" "}
            butir
          </small>
        </div>
        <div className="metric-card">
          <p>Piutang penjualan</p>
          <strong>{money(balance)}</strong>
          <small>
            {sales.filter((s) => s.balance > 0).length} transaksi belum lunas
          </small>
        </div>
        <div className="metric-card">
          <p>Pemakaian pakan</p>
          <strong>
            {number(usages.reduce((a, u) => a + u.quantity, 0))}{" "}
            <small>kg</small>
          </strong>
          <small>{usages.length} pencatatan pemakaian</small>
        </div>
      </div>
      <section className={`panel ${styles.typeSummary}`} aria-label="Ringkasan tiap jenis telur">
        <div className="panel-header"><div><h3>Ringkasan tiap jenis telur</h3><p>Hasil panen dan penjualan pada periode yang dipilih.</p></div></div>
        <div className={styles.compactSummary}>
          {[
            ...summaryTypes.map(type => ({ label: eggTypeLabel(type), harvest: harvestSummary.byType[type], sale: saleSummary.byType[type] })),
            { label: "Subtotal bagus (SKM + SKM Baru)", harvest: harvestSummary.bagus, sale: saleSummary.bagus },
            { label: "Total seluruh telur", harvest: harvestSummary.total, sale: { ...saleSummary.total, amount: total } },
          ].map(row => <div key={row.label} className={styles.compactType}>
            <h4>{row.label}</h4>
            <dl><div><dt>Panen</dt><dd>{number(row.harvest.eggs, 0)} butir <span>{number(row.harvest.kg, 3)} kg</span></dd></div><div><dt>Terjual</dt><dd>{number(row.sale.kg, 3)} kg <span>{money(row.sale.amount)}</span></dd></div></dl>
          </div>)}
        </div>
        <div className={`table-responsive ${styles.summaryTable}`}><table className="table farm-table">
          <thead><tr><th>Jenis telur</th><th className="text-end">Panen (butir)</th><th className="text-end">Panen (kg)</th><th className="text-end">Terjual (kg)</th><th className="text-end">Omzet</th></tr></thead>
          <tbody>{summaryTypes.map(type => <tr key={type}><td>{eggTypeLabel(type)}</td><td className="text-end">{number(harvestSummary.byType[type].eggs, 0)}</td><td className="text-end">{number(harvestSummary.byType[type].kg, 3)}</td><td className="text-end">{number(saleSummary.byType[type].kg, 3)}</td><td className="text-end">{money(saleSummary.byType[type].amount)}</td></tr>)}</tbody>
          <tfoot>
            <tr><th>Subtotal bagus (SKM + SKM Baru)</th><td className="text-end">{number(harvestSummary.bagus.eggs, 0)}</td><td className="text-end">{number(harvestSummary.bagus.kg, 3)}</td><td className="text-end">{number(saleSummary.bagus.kg, 3)}</td><td className="text-end">{money(saleSummary.bagus.amount)}</td></tr>
            <tr><th>Total seluruh telur</th><td className="text-end">{number(harvestSummary.total.eggs, 0)}</td><td className="text-end">{number(harvestSummary.total.kg, 3)}</td><td className="text-end">{number(saleSummary.total.kg, 3)}</td><td className="text-end">{money(total)}</td></tr>
          </tfoot>
        </table></div>
      </section>
      <section className="panel mb-4">
        <div className="panel-header">
          <div>
            <h3>Omzet pada periode terpilih</h3>
            <p>Nilai transaksi penjualan per hari</p>
          </div>
        </div>
        {chart.length > 0 ? (
          <div className="report-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chart}
                margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 4"
                  stroke="#e9eee2"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "#94a086" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${number(v / 1000000)}jt`}
                  tick={{ fontSize: 9, fill: "#94a086" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v) => [money(Number(v)), "Omzet"]}
                  contentStyle={{
                    borderRadius: 9,
                    border: "1px solid #e4ebda",
                    fontSize: 11,
                  }}
                />
                <Bar
                  dataKey="omzet"
                  fill="#789b58"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="empty-state">
            Belum ada penjualan pada periode ini.
          </div>
        )}
      </section>
      <section className="panel">
        <div className="report-tabs" role="tablist" aria-label="Jenis laporan">
          {tables.map((t, i) => (
            <button
              role="tab"
              aria-selected={tab === i}
              key={t.name}
              className={tab === i ? "active" : ""}
              onClick={() => setTab(i)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="table-responsive">
          <table className="table farm-table">
            <thead>
              <tr>
                {selected.columns.map((c) => (
                  <th key={c}>{c.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      {formatReportCell(cell, selected.columns[j])}
                    </td>
                  ))}
                </tr>
              ))}
              {selected.rows.length === 0 && (
                <tr>
                  <td colSpan={selected.columns.length}>
                    <div className="empty-state">
                      Belum ada data pada rentang tanggal ini.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
