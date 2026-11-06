"use client";

import { useMemo, useRef, useState } from "react";
import { useFarm } from "@/lib/store";
import { businessDate, dateLabel, money, today } from "@/lib/domain";
import {
  dueStatus,
  historicalPaid,
  groupInvoices,
  type FarmInvoice,
} from "@/lib/invoice-ledger";
import {
  Dialog,
  Field,
  LoadingButton,
  Pill,
  dataFrom,
  errorMessage,
  methodLabel,
} from "./ModuleUI";

function dueLabel(invoice: FarmInvoice, day: string) {
  const status = dueStatus(invoice, day);
  if (status === "paid") return "Lunas";
  if (status === "undated") return "Jatuh tempo belum diatur";
  if (status === "today") return "Jatuh tempo hari ini";
  return (
    (status === "overdue" ? "Lewat jatuh tempo · " : "Jatuh tempo ") +
    dateLabel(invoice.due_date!)
  );
}

export function InvoiceHistory({ invoice }: { invoice: FarmInvoice }) {
  const { state } = useFarm();
  const prior = historicalPaid(invoice);
  if (!invoice.total) return null;
  return (
    <section
      className="mt-3 border rounded p-3"
      aria-label="Riwayat pembayaran"
    >
      <h3 className="h6">Riwayat pembayaran</h3>
      {invoice.balance > 0 && (
        <p className="small">{dueLabel(invoice, today())}</p>
      )}
      {prior > 0 && (
        <p className="small mb-2">
          Sudah dibayar sebelumnya: <strong>{money(prior)}</strong>. Rincian
          tanggal pembayaran lama tidak tersedia.
        </p>
      )}
      {!invoice.paid && (
        <p className="small text-muted mb-0">Belum ada pembayaran.</p>
      )}
      {!!invoice.payments?.length && (
        <ul className="list-unstyled mb-0">
          {invoice.payments.map((entry, i) => (
            <li className="py-2 border-top" key={i}>
              <div className="d-flex flex-wrap justify-content-between gap-2">
                <span>
                  {entry.kind === "initial" ? "Pembayaran awal" : "Cicilan"}
                  {entry.method ? " · " + methodLabel(entry.method) : ""}
                </span>
                <strong>{money(entry.amount)}</strong>
              </div>
              <small className="text-muted">
                Dicatat {dateLabel(entry.recorded_at, true)} WIB ·{" "}
                {state.users.find((u) => u.id === entry.user_id)?.name ||
                  "Petugas"}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InvoiceDialog({
  invoice,
  onClose,
  initialTab = "payment",
}: {
  invoice: FarmInvoice;
  onClose: () => void;
  initialTab?: "payment" | "due";
}) {
  const { command } = useFarm();
  const [tab, setTab] = useState(initialTab);
  const [openingPaid] = useState(invoice.paid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const supplier = "supplier" in invoice;
  const changed = openingPaid !== invoice.paid;
  const close = () => {
    if (pending.current) return false;
    onClose();
  };
  const hasBalance = invoice.balance > 0;
  return (
    <Dialog
      title={supplier ? "Pembayaran ke pemasok" : "Pembayaran pelanggan"}
      subtitle={
        invoice.number +
        " · " +
        (supplier
          ? invoice.supplier
          : invoice.customer || "Nama belum tercatat")
      }
      onClose={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current || !hasBalance || (tab === "payment" && changed))
            return;
          const data = dataFrom(e.currentTarget);
          pending.current = true;
          setBusy(true);
          setError("");
          let success = false;
          try {
            if (tab === "due")
              await command(supplier ? "feed.due" : "sale.due", {
                id: invoice.id,
                due_date: data.due_date,
              });
            else
              await command(supplier ? "feed.payment" : "sale.payment", {
                id: invoice.id,
                amount: Number(data.amount),
                expected_paid: openingPaid,
                method: data.method,
              });
            success = true;
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            pending.current = false;
            setBusy(false);
          }
          if (success) onClose();
        }}
      >
        <div className="modal-body-custom">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="form-summary mb-3">
            <span>Sisa tagihan</span>
            <strong>{money(invoice.balance)}</strong>
          </div>
          {hasBalance && (
            <fieldset disabled={busy}>
              <div
                className="d-flex gap-2 flex-wrap mb-3"
                aria-label="Pilihan tagihan"
              >
                <button
                  type="button"
                  className={
                    "btn btn-sm " +
                    (tab === "payment" ? "btn-primary" : "btn-light")
                  }
                  aria-pressed={tab === "payment"}
                  onClick={() => {
                    setTab("payment");
                    setError("");
                  }}
                >
                  Catat pembayaran
                </button>
                <button
                  type="button"
                  className={
                    "btn btn-sm " +
                    (tab === "due" ? "btn-primary" : "btn-light")
                  }
                  aria-pressed={tab === "due"}
                  onClick={() => {
                    setTab("due");
                    setError("");
                  }}
                >
                  Atur jatuh tempo
                </button>
              </div>
              {tab === "due" ? (
                <Field className="d-block" label="Jatuh tempo">
                  <input
                    className="form-control"
                    name="due_date"
                    type="date"
                    min={businessDate(invoice.date)}
                    defaultValue={invoice.due_date || ""}
                    required
                  />
                </Field>
              ) : (
                <>
                  {changed && (
                    <div role="alert" className="alert alert-warning">
                      Pembayaran pada nota ini sudah berubah. Tutup dan buka
                      kembali nota setelah memeriksa riwayat di bawah.
                    </div>
                  )}
                  <Field
                    className="d-block mb-3"
                    label={
                      supplier
                        ? "Uang yang dibayar ke pemasok (Rp)"
                        : "Uang yang diterima (Rp)"
                    }
                  >
                    <input
                      className="form-control"
                      name="amount"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max={invoice.balance}
                      step="1"
                      defaultValue={invoice.balance}
                      required
                    />
                  </Field>
                  <Field className="d-block" label="Cara pembayaran">
                    <select
                      name="method"
                      className="form-select"
                      defaultValue="cash"
                    >
                      <option value="cash">Tunai</option>
                      <option value="transfer">Transfer</option>
                      <option value="qris">QRIS</option>
                    </select>
                  </Field>
                </>
              )}
            </fieldset>
          )}
          <InvoiceHistory invoice={invoice} />
        </div>
        <div className="modal-footer-custom">
          <button
            className="btn btn-light"
            type="button"
            onClick={close}
            disabled={busy}
          >
            Tutup
          </button>
          {hasBalance && (
            <LoadingButton busy={busy} disabled={tab === "payment" && changed}>
              {tab === "due" ? "Simpan jatuh tempo" : "Simpan pembayaran"}
            </LoadingButton>
          )}
        </div>
      </form>
    </Dialog>
  );
}

export function InvoiceTasks({
  invoices,
  supplier = false,
}: {
  invoices: FarmInvoice[];
  supplier?: boolean;
}) {
  const [openId, setOpenId] = useState("");
  const [filter, setFilter] = useState<
    "open" | "overdue" | "undated" | "paid" | "all"
  >("open");
  const [search, setSearch] = useState("");
  const day = today();
  const groups = useMemo(() => groupInvoices(invoices), [invoices]);
  const total = groups.reduce((sum, g) => sum + g.balance, 0);
  const active = invoices.find((i) => i.id === openId);
  const heading = supplier ? "Utang ke pemasok" : "Tagihan per pelanggan";
  return (
    <section className="panel p-3 my-3" aria-label={heading}>
      <details>
        <summary className="fw-semibold">
          {heading} · {money(total)}
        </summary>
        <p className="small text-muted mt-2">
          Termasuk nota dari bulan sebelumnya. Pilih “Lunas” untuk melihat
          riwayat pembayaran.
        </p>
        {groups.length > 0 ? (
          <>
            <div className="d-flex flex-wrap gap-2 mb-3">
              <input
                className="form-control"
                aria-label="Cari nama atau nomor nota tagihan"
                placeholder="Cari nama atau nomor nota…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Status tagihan"
                className="form-select"
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
              >
                <option value="open">Belum lunas</option>
                <option value="overdue">Lewat jatuh tempo</option>
                <option value="undated">Belum ada tanggal</option>
                <option value="paid">Lunas</option>
                <option value="all">Semua nota</option>
              </select>
            </div>
            <InvoiceGroups
              groups={groups}
              search={search}
              filter={filter}
              day={day}
              openInvoice={setOpenId}
            />
          </>
        ) : (
          <p className="mb-0">Belum ada nota.</p>
        )}
      </details>
      {active && (
        <InvoiceDialog
          invoice={active}
          key={active.id}
          onClose={() => setOpenId("")}
        />
      )}
    </section>
  );
}

function InvoiceGroups({
  groups,
  search,
  filter,
  day,
  openInvoice,
}: {
  groups: ReturnType<typeof groupInvoices>;
  search: string;
  filter: string;
  day: string;
  openInvoice: (id: string) => void;
}) {
  const query = search.toLocaleLowerCase("id").trim();
  const matched = groups
    .map((g) => ({
      ...g,
      invoices: g.invoices.filter(
        (i) =>
          (filter === "all" ||
            (filter === "open" && i.balance > 0) ||
            dueStatus(i, day) === filter) &&
          (g.party + " " + g.phone + " " + i.number)
            .toLocaleLowerCase("id")
            .includes(query),
      ),
    }))
    .filter((g) => g.invoices.length);
  if (!matched.length)
    return <p className="small mb-0">Tidak ada tagihan yang sesuai.</p>;
  return (
    <div className="d-grid gap-2">
      {matched.map((g) => (
        <details key={g.key} className="border rounded p-2">
          <summary>
            <strong>{g.party}</strong> ·{" "}
            {money(g.invoices.reduce((s, i) => s + i.balance, 0))} ·{" "}
            {g.invoices.length} nota{g.phone && <small> · {g.phone}</small>}{" "}
            <small>({dueLabel(g.invoices[0], day)})</small>
          </summary>
          {g.invoices.map((i) => (
            <div
              key={i.id}
              className="border-top mt-2 pt-2 d-flex flex-wrap justify-content-between align-items-center gap-2"
            >
              <div>
                <strong>{i.number}</strong> · {dateLabel(i.date)}
                <br />
                <small>
                  Total {money(i.total)} · Sisa {money(i.balance)} ·{" "}
                </small>
                <Pill
                  tone={dueStatus(i, day) === "overdue" ? "warning" : "neutral"}
                >
                  {dueLabel(i, day)}
                </Pill>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={() => openInvoice(i.id)}
              >
                {i.balance > 0 ? "Kelola tagihan" : "Lihat riwayat"}
              </button>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
