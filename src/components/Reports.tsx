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
import {
  businessDate,
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
  type ReportTable,
} from "@/lib/export";
import { categoryLabel, methodLabel } from "./ModuleUI";

export default function Reports() {
  const { state, user } = useFarm();
  const [from, setFrom] = useState(today().slice(0, 7) + "-01");
  const [to, setTo] = useState(today());
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const inRange = (date: string) =>
    businessDate(date) >= from && businessDate(date) <= to;
  const sales = state.sales.filter((s) => inRange(s.date));
  const production = state.productions.filter((p) => inRange(p.date));
  const purchases = state.feed_purchases.filter((p) => inRange(p.date));
  const usages = state.feed_usages.filter((p) => inRange(p.date));
  const employee = (id: string) =>
    state.users.find((u) => u.id === id)?.name || "Karyawan";
  const tables: ReportTable[] = [
    {
      name: "Penjualan",
      columns: [
        "Nomor",
        "Tanggal",
        "Karyawan",
        "Pelanggan",
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
        employee(s.user_id),
        s.customer || "Umum",
        s.items.reduce((a, i) => a + i.kg, 0),
        s.items.filter(isFreeSaleItem).reduce((a, i) => a + i.kg, 0),
        s.total,
        s.paid,
        s.balance,
        s.total === 0 ? "Gratis" : methodLabel(s.payment_method),
      ]),
    },
    {
      name: "Produksi",
      columns: [
        "Tanggal",
        "Karyawan",
        "Kandang",
        "Kategori",
        "Butir",
        "Berat (kg)",
        "Krat",
        "Catatan",
      ],
      rows: production.map((p) => [
        p.date,
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
              "Tanggal",
              "Pemasok",
              "Total (Rp)",
              "Dibayar (Rp)",
              "Sisa (Rp)",
            ],
            rows: purchases.map((p) => [
              p.number,
              p.date,
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
        "Tanggal",
        "Karyawan",
        "Pakan",
        "Kandang",
        "Jumlah (kg)",
        "Catatan",
      ],
      rows: usages.map((u) => [
        u.date,
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
        "Tanggal WIB",
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
          employee(m.user_id),
          categoryLabel(m.category),
          {
            production: "Produksi",
            pickup: "Pengambilan",
            return: "Pengembalian",
            correction: "Koreksi",
          }[m.kind],
          m.eggs,
          m.kg,
          m.trays,
          m.notes,
        ]),
    },
    {
      name: "Stok saat ini",
      columns: ["Waktu pencatatan WIB", "Kategori", "Butir", "Berat (kg)"],
      rows: (["good", "cracked"] as const).map((c) => {
        const stock = eggStock(state, c);
        return [
          new Date().toISOString(),
          categoryLabel(c),
          stock.eggs,
          stock.kg,
        ];
      }),
    },
  ];
  const selected = tables[Math.min(tab, tables.length - 1)];
  const chart = useMemo(() => {
    const grouped = new Map<string, number>();
    state.sales
      .filter((s) => businessDate(s.date) >= from && businessDate(s.date) <= to)
      .forEach((s) =>
        grouped.set(
          businessDate(s.date),
          (grouped.get(businessDate(s.date)) || 0) + s.total,
        ),
      );
    return [...grouped]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, omzet]) => ({ date: dateLabel(date), omzet }));
  }, [state.sales, from, to]);
  const total = sales.reduce((a, s) => a + s.total, 0),
    balance = sales.reduce((a, s) => a + s.balance, 0);
  const invalid = from > to || !from || !to;
  async function download(format: string) {
    setBusy(format);
    setError("");
    try {
      if (invalid) throw new Error("Pilih rentang tanggal yang benar.");
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
          <p>Kenali perkembangan peternakan melalui angka yang berarti.</p>
        </div>
        <span className="icon-box green">
          <BarChart3 size={23} />
        </span>
      </div>
      <section className="panel report-filters">
        <div className="form-field">
          <label htmlFor="report-from">Tanggal mulai</label>
          <input
            id="report-from"
            type="date"
            className="form-control"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
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
            onChange={(e) => setTo(e.target.value)}
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
          {error || "Tanggal akhir harus sama atau setelah tanggal mulai."}
        </div>
      )}
      <p className="report-caption">
        Menampilkan {dateLabel(from)} – {dateLabel(to)} ·{" "}
        {user?.role === "admin" ? "Seluruh peternakan" : "Data milik Anda"} ·
        Target dibandingkan dengan omzet pada periode yang dipilih.
      </p>
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
